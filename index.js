const fs = require('fs');
const args = require('./config');
const lib = require('./lib');
const express = require('express');
const readline = require('readline');
const db_tester = require('./test-utils/db-tester');
const client_api = require('./test-utils/client-api');
const app = express();


const sqlDefs = {
    host: args.sql_host,
    port: args.sql_port,
    db_name: args.sql_db,
    root_pass: args.sql_root_pass,
    user_name: args.sql_user,
    user_pass: args.sql_pass  
};

const dockerDefs = args.use_docker? {
    container: 'mysql:5.7.26',
    prefix: args.docker_prefix
} : false;

const HTTP_PORT = args.http_port;
const MIGRATIONS_DIR = args.migrations;
const TABLES_DIR = args.tables;
const PROGRAM_NAME = `db-stager`;
let SAVE_SQL_PATH = args.save_file? args.save_file : null;
let server = null;


/** Set on init, this is a lambda to rebuild the DB data from SQL scripts. */
let rebuilding = true;


app.get('/rebuild_db', async(req, res) => {
	if(rebuilding){
		return res.status(425).send("Rebuild is already in progress, please wait.");
	}
	if(req.query.file){
		if(TABLES_DIR){
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
		await lib.rebuild(SAVE_SQL_PATH, MIGRATIONS_DIR)
	}catch(err){
		res.status(500).send('Error encountered while rebuilding: ' + err);
	}
	rebuilding = false;
	
	let source = TABLES_DIR ? TABLES_DIR : SAVE_SQL_PATH;
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
	<a href="http://localhost:3001/rebuild_db">rebuild_db</a>  <br><br>
	<a href="http://localhost:3001/save_db">save_db</a>  <br><br>
	<a href="http://localhost:3001/terminate">terminate</a>  <br><br>`;
	res.send(r);
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
const startServer = async(initialFile=null) => {
	SAVE_SQL_PATH = initialFile;
	try{
		server = app.listen(HTTP_PORT, () => console.log(`HTTP Controls listening on http://localhost:${HTTP_PORT} !`));
		if(TABLES_DIR){
			await lib.createFromTables(TABLES_DIR, MIGRATIONS_DIR, sqlDefs, dockerDefs);
		}else{
			await lib.load(SAVE_SQL_PATH, MIGRATIONS_DIR, sqlDefs, dockerDefs);
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
		server.close(() => {
			console.log('HTTP server closed.');
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
		await lib.save(SAVE_SQL_PATH, MIGRATIONS_DIR);
		console.log("Saved database state to SQL file: " + SAVE_SQL_PATH);
	}
	console.log("Terminating...");
	await lib.cleanup();
	process.exit(0);
};


if (require.main === module) {
	startServer().then(() => waitForUserExit()).catch( err =>{
		console.error(err);
		process.exit(1);
	});
}


module.exports = {
	startServer,
	start: startServer,

	stopServer,
	stop: stopServer,
	terminate: stopServer,

	dbTester: db_tester,
	api: client_api
};
