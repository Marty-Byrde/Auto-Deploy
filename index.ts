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
  console.log("Initializing database connection...")
  dbHandler = new DBHandler(process.env.MONGO_HOST, parseInt(process.env.MONGO_PORT))
  await dbHandler.connect()

  collection = await dbHandler.getCollection(process.env.MONGO_DB, process.env.MONGO_COLLECTION)
  const items = await collection.findType<AutoDeployItem>({})
  console.log(`${items.length} auto-deploy entries found in the database.`)

  console.log(`Configuring the rate limits for this express-app...`)
  app.listen(process.env.PORT, async () => {
    console.log(`Server has been started on port ${process.env.PORT}`)
  })

  const rateLimt = Math.round(items.length * 1.5)
  app.use(queue({ activeLimit: rateLimt, queuedLimit: -1 }));
  console.log(`Active requests limited to ${rateLimt}.`)
}


async function executeDeploymentJob(deployment_config: AutoDeployItem) {
  console.log(`Executing auto-deploy for ${deployment_config.name}...`)
  const connection = await sshClient.connect({
    host: deployment_config.vps_ip,
    username: deployment_config.vps_Credentials.username,
    password: deployment_config.vps_Credentials.password
  })
  console.log(`Connected to the VPS.`)

  const responses = deployment_config.scriptLines.map(async (script) => {
    const { command, args, passwordRequired } = script
    const sudoPassword = { stdin: deployment_config.vps_Credentials.password + "\n", execOptions: { pty: true } }

    return passwordRequired ?
      connection.exec(command, args ?? [], sudoPassword) :
      connection.execCommand(`${command} ${args?.join(" ")}`)
  })

  return Promise.all(responses);
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