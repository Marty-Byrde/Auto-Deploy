import express, { Express, Request, Response } from "express"
import bodyParser from "body-parser"
import queue from 'express-queue';
import * as dotenv from 'dotenv'
import { AdvancedCollection, DBHandler } from 'mongodb_handler'
import { NodeSSH, SSHExecCommandResponse } from 'node-ssh'

dotenv.config({ path: './.env' })
const app: Express = express()
const sshClient = new NodeSSH()

let dbHandler: DBHandler
let collection: AdvancedCollection;

interface AutoDeployItem {
  key: string
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
