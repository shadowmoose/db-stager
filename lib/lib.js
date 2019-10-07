const config = require('../config').opts;
const {log} = require('./log');
const docker = require('./docker_mysql');
const sql = require('./mysql_handler');
const fs = require('fs');
const migrations = require('./migration_finder');
const readline = require('readline');


let created = false;
let dockerInstance = null;


const init = async(sql_save, migrations_dir, tables_dir) => {
    if(created) return true;
    created = true;

    if(config.use_docker){
        dockerInstance = new docker.Docker();
        await dockerInstance.purge();
        await dockerInstance.create();
    }
    await sql.init();
	if(!tables_dir){
		if(sql_save) await init_from_file(sql_save, migrations_dir);
	}else{
		await init_from_tables(tables_dir);
	}
    return true;
};

/**
 * Build the database using a save file. Also checks for new migrations, and applies them.
 * @param {string} save_file Path to the file to load.
 * @param {string} migrations Path to the directory containing DB migrations.
 */
const load = async(save_file, migrations) => {
    return init(save_file, migrations, null);
};

/**
 * Build the database fresh, using the tables within the given directory. 
 * Assumes all migrations are up to date with the current table structure.
 * @param {string} tables_dir Path to directory containing the table SQL files.
 * @param {string} migrations Path to the directory containing DB migrations.
 */
const createFromTables = async(tables_dir, migrations) => {
    return init(`./db-save.sql`, migrations, tables_dir)
};

/**
 * Recreates the running SQL Database, using the given SQL Save & Migrations files, or the defaults created on init.
 * Applies any new migrations found.
 *
 * @param {string} sql_save The path to the save file
 * @param {string} migrations_dir The directory to load migrations from
 */
const rebuild = async(sql_save, migrations_dir) => {
    await sql.recreate_db();
    await init_from_file(sql_save, migrations_dir);
};

/**
 * Saves the current database structure & data to a file. Also tracks current migrations.
 * Accepts custom paths, or falls back to defaults from init.
 * @param {string} sql_save The file to save the SQL Database into.
 * @param {string} migrations_dir The path to any migration files that should be included.
 */
const save = async(sql_save, migrations_dir) => {
    let known_migrations = await migrations.findAll(migrations_dir);
	return sql.dump(sql_save, known_migrations);
};

/** Kill Docker. */
const cleanup = async() => {
    if(!dockerInstance) return true;
    log.debug('Shutting down Docker container...');
	return dockerInstance.stop();
};

module.exports = {
    load,
    createFromTables,
    rebuild,
    save,
    cleanup
};


const init_from_file = async(sql_file, migrations_dir) => {
	if (fs.existsSync(sql_file)) {
		await sql.run_sql_file(sql_file);
		log.debug("Rebuilt SQL database from save file: " + sql_file);
		await check_migrations(sql_file, migrations_dir);
	}else{
		log.error(`Attempted to load SQL from file '${sql_file}', but no file was found.`);
		log.warn(`Make sure 'save_file' is correct - or make changes to the new database and save them.`);
	}
};


const init_from_tables = async(TABLES_DIR) => {
	if(!fs.existsSync(TABLES_DIR)) throw Error('The "tables" parameter was provided, but the given directory does not exist!');
	let tables = await migrations.findAll(TABLES_DIR);
	let created = [];
	let open = [];

	log.log("Building DB from tables directory:", TABLES_DIR);

	for(let t of tables){
		let ref = await sql.getReferences(t.file);
		ref.file = t.file;
		open.push(ref)
	}

	let len = open.length;
	while(len){
		for(let o of open){
			if(o.refs.length && !o.refs.every(r => created.includes(r) || o.creates.includes(r))){
				continue;
			}
			log.debug("Building table:", JSON.stringify(o));
			await sql.run_sql_file(o.file);
			for(let c of o.creates){
				created.push(c);
			}
			open.splice(open.indexOf(o), 1);
			break;
		}
		if(open.length === len){
			throw Error("Unable to resolve table dependencies." + JSON.stringify(open) +' || Created: '+ JSON.stringify(created));
		}
		len = open.length;
	}
};

/** 
 * Compares the known Migration data encoded inside the given SQL file 
 * against the migration '*.sql' files within the given directory.
 * 
 * If any new files are found, the user will be prompted to apply them.
 * If migrations previously-used are missing or changed, raises an Error.
 */
const check_migrations = async(sql_file, migrations_dir, prompt_user=false) => {
	let past_migrations = await sql.read_config(sql_file, 'known_migrations');
	if(!past_migrations) return;

	let new_migrations = await migrations.findAll(migrations_dir);
	past_migrations.values.forEach(m => {
		let idx = new_migrations.findIndex(nm => {
			return nm.hash === m.hash;
		});
		if(idx < 0){
			throw Error("ERROR: One of the previously-used migrations is missing or changed: "+m.file);
		}
		new_migrations.splice(idx, 1);
	});
	
	if(new_migrations.length){
		log.debug("Found new database migrations:");
		new_migrations.forEach(nm => {log.debug(`\t+"${nm.file}"`)});
		let resp = prompt_user? await prompt('Do you want to apply these changes? (y/n): ') : 'y';
		if(resp.toLowerCase().includes('y')){
            for(let nm of new_migrations){
                log.debug(`\t+Applying "${nm.file}"...`);
                await sql.run_sql_file(nm.file);
            }
		}
	}
};


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
