import express, { Express, Request, Response } from "express"
import bodyParser from "body-parser"
import queue from 'express-queue';
import * as dotenv from 'dotenv'
import { AdvancedCollection, DBHandler } from 'mongodb_handler'
import { NodeSSH } from 'node-ssh'
import colors from "colors"

dotenv.config({ path: './.env' })
const app: Express = express()
const sshClient = new NodeSSH()

let dbHandler: DBHandler
let collection: AdvancedCollection;

interface AutoDeployItem {
  key: string,
  name: string,
  vps_ip: string
  vps_Credentials: {
    username: string
    password: string
  },
  scriptLines: ScriptLine[],
}

interface ScriptLine {
  command: string
  args?: string[],
  passwordRequired?: boolean
}

const getTimestamp = () => {
  const date = new Date(Date.now())
  const formatTwoDigit = (value: string | number) => value.toString().length === 1 ? `0${value}` : value
  return colors.green(`[${formatTwoDigit(date.getDate())}.${formatTwoDigit((date.getMonth() + 1))}.${date.getFullYear().toString().slice(2)} ${formatTwoDigit(date.getHours())}:${formatTwoDigit(date.getMinutes())}:${formatTwoDigit(date.getSeconds())}]`)
}


init()

async function init() {
  // @ts-ignore
  const ConfigTag = () => `${getTimestamp()} ${colors.brightRed("[Config]")}`
  console.log(`${ConfigTag()} Initializing database connection...`)
  dbHandler = new DBHandler(process.env.MONGO_HOST, parseInt(process.env.MONGO_PORT))
  await dbHandler.connect()

  collection = await dbHandler.getCollection(process.env.MONGO_DB, process.env.MONGO_COLLECTION)
  const items = await collection.findType<AutoDeployItem>({})
  console.log(`${ConfigTag()} Watching for ${items.length} development-jobs.`)

  console.log(`${ConfigTag()} Configuring the rate limits for this express-app...`)
  app.listen(process.env.PORT, async () => {
    console.log(`${ConfigTag()} Server has been started on port ${process.env.PORT}`)
  })

  const rateLimt = Math.round(items.length * 1.5)
  app.use(queue({ activeLimit: rateLimt, queuedLimit: -1 }));
  console.log(`${ConfigTag()} Active requests limited to ${rateLimt}.`)
}


async function executeDeploymentJob(deployment_config: AutoDeployItem) {
  console.log(`${getTimestamp()} Executing auto-deploy for ${colors.yellow(deployment_config.name)}...`)
  const connection = await sshClient.connect({
    host: deployment_config.vps_ip,
    username: deployment_config.vps_Credentials.username,
    password: deployment_config.vps_Credentials.password
  })
  console.log(`${getTimestamp()} Connected to the VPS.`)

  console.log(`${getTimestamp()} Executing the scripts...`)
  const responses = deployment_config.scriptLines.map(async (script) => {
    const { command, args, passwordRequired } = script
    const sudoPassword = { stdin: deployment_config.vps_Credentials.password + "\n", execOptions: { pty: true } }

    return passwordRequired ?
      connection.exec(command, args ?? [], sudoPassword) :
      connection.execCommand(`${command} ${args?.join(" ")}`)
  })
  const result = Promise.all(responses);
  console.log(`${getTimestamp()} All scripts (${deployment_config.scriptLines.length}) have been executed.`)

  return result
}


app.get(`/${process.env.DEPLOY_ROUTE}/`, async (req: Request, res: Response) => {
  const { key } = req.query
  const job = (await collection.findType<AutoDeployItem>({ key: key }))?.at(0)

  if(!job) return res.sendStatus(200)

  const {name} = job
  console.log(`${getTimestamp()} An deployment-job (${colors.yellow(name)}) was found and will be executed...`)
  await executeDeploymentJob(job)
  console.log(`${getTimestamp()} The deployment-job (${colors.yellow(name)}) has been completed.`)

  res.sendStatus(202)
})