#!/usr/bin/env node

const fs = require('fs');
const config = require('./config');
const lib = require('./lib/lib');
const express = require('express');
const readline = require('readline');
const db_tester = require('./utils/db-tester');
const client_api = require('./utils/client-api');
const AsyncLock = require('async-lock');

const lock = new AsyncLock();
const app = express();
const expressWs = require('express-ws')(app);
const args = config.opts;
const PROGRAM_NAME = `db-stager`;

let SAVE_SQL_PATH = null;
let server = null;
let wssPing = null;
let wsClients = [];


/** Set on init, this is a lambda to rebuild the DB data from SQL scripts. */
let rebuilding = true;


app.get('/rebuild_db', async(req, res) => {
	console.log('rebuild');
	if(rebuilding){
		return res.status(425).send("Rebuild is already in progress, please wait.");
	}
	if(req.query.file){
		if(args.tables){
			return res.status(500).send("The DB was initially built from tables dir. Please restart before loading from file.");
		}
		if(!fs.existsSync(req.query.file)){
			return res.status(404).send('The given file does not exist!');
		}
		SAVE_SQL_PATH = req.query.file;
	}

	rebuilding = true;
	let rstart = new Date().getTime();
	try{
		await lib.rebuild(SAVE_SQL_PATH, args.migrations)
	}catch(err){
		res.status(500).send('Error encountered while rebuilding: ' + err);
	}
	rebuilding = false;

	let source = args.tables ? args.tables : SAVE_SQL_PATH;
	res.send(`Rebuilt DB in ${(new Date().getTime() - rstart)/1000} seconds from: ${source}. <br><a href="/">Back</a>`);
});

app.get('/save_db', async(req, res) => {
	if(rebuilding){
		return res.status(425).send("Rebuild is in progress, please retry later.");
	}
	if(req.query.file){
		SAVE_SQL_PATH = req.query.file;
	}
	if(!SAVE_SQL_PATH) return res.status(500).send('Error: No file has been loaded yet - cannot save!');
	try {
		await lib.save(SAVE_SQL_PATH);
		console.log("Saved database state to SQL file!");
		res.send(`Saved database & current migrations to SQL File: <b>${SAVE_SQL_PATH}</b> <br><a href="/">Back</a>`);
	}catch(err){
		res.status(500).send('Error saving: ' + err);
	}
});

app.get('/terminate', async(req, res) => {
	console.warn("\nShutting down...");
	res.send(`Terminating ${PROGRAM_NAME}. <br><a href="/">Back</a>`);
	await stopServer();
});

app.get('/', (req, res) => {
	let r = `<title>${PROGRAM_NAME}</title>
	<h1>${PROGRAM_NAME}</h1> 
	<b>Loaded: </b>${SAVE_SQL_PATH} <br>
	<h3>Endpoints:</h3>
	<a href="/rebuild_db">rebuild_db</a>  <br><br>
	<a href="/save_db">save_db</a>  <br><br>
	<a href="/terminate">terminate</a>  <br><br>`;
	res.send(r);
});

app.ws('/lock', function(ws, req) {
	ws.isAlive = true;
	ws.id = Math.random();

	let resolve = null;
	let p = new Promise((res)=> {resolve = res});

	ws.on('pong', () => {ws.isAlive = true; console.log('Pong')});
	ws.on('close', () => {
		wsClients = wsClients.filter(c => c !== ws);
		resolve();
	});
	ws.on('error', () => {
		resolve();
	});

	lock.acquire('key', () => {
		try{
			ws.send('OK');
		}catch(err){
			console.error(err);
			ws.close();
		}
		let rp = p;
		if(args.http_max_lock_ms){
			rp = Promise.race([p, new Promise((res, rej) => {
				setTimeout(()=> {rej('Client lock timed out.'); ws.close()}, args.http_max_lock_ms);
			})]);
		}
		return rp; // Return a Promise, which awaits the socket close before resolving.
	}).catch((err)=>{console.error(err)});
	wsClients.push(ws);
});


const prompt = async(question)=> {
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout
	});
	return new Promise(resolve => {
		rl.question(question, (input) => {
			rl.close();
			resolve(input);
		})
	});
};


/**
 * Launch the server, building the Docker container & database as-needed.
 */
const startServer = async(options=null) => {
	if(options) config.configure(options);
	if(server) throw new Error('Attempted to restart running server!');
	SAVE_SQL_PATH = args.save_file;
	try{

		//start our server
		server = app.listen(args.http_port, args.http_host);
		console.debug(`Started the ${PROGRAM_NAME} server on http://${args.http_host}:${args.http_port}/`);

		wssPing = setInterval(() => {
			wsClients.forEach((ws) => {
				if (ws.isAlive === false) return ws.terminate();
				ws.isAlive = false;
				ws.ping();
			});
		}, 15000);

		if(args.tables){
			await lib.createFromTables(args.tables, args.migrations);
		}else{
			await lib.load(SAVE_SQL_PATH, args.migrations);
		}
		rebuilding = false;
	}catch(err){
		console.error("Encountered error booting server. Cleaning up resources before raising...");
		console.error(err);
		await stopServer();
		throw err;
	}
};


/**
 * Shut down the running database & HTTP API, then clean up the stopped Docker container.
 */
const stopServer = async() => {
	return new Promise( res => {
		clearInterval(wssPing);
		server.close(() => {
			console.debug('HTTP server closed. Cleaning up MySQL...');
			res(lib.cleanup());
		});
	});
};


/**
 * If run directly from command line, this program supports a
 * (really basic) terminal-side exit/save option.
 */
const waitForUserExit = async() => {
	let inp = await prompt("Press enter to exit (type 's' to save any database changes before exit): ");

	if(inp && inp.toLowerCase().includes('s')){
		await lib.save(SAVE_SQL_PATH, args.migrations);
		console.log("Saved database state to SQL file: " + SAVE_SQL_PATH);
	}
	console.log("Terminating...");
	await lib.cleanup();
	process.exit(0);
};


if (require.main === module) {
	config.parseFromArgs();
	console.log("Launching standalone...");
	startServer().then(() => waitForUserExit()).catch( err =>{
		console.error(err);
		console.error('Shutting down standalone server.');
		process.exit(1);
	});
}


module.exports = {
	startServer,
	start: startServer,

	stopServer,
	stop: stopServer,
	terminate: stopServer,
	configure: config.configure,

	dbTester: db_tester,
	api: client_api
};
