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