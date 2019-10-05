const mysqldump = require('mysqldump');
const mysql = require('mysql2/promise');
const fs = require('fs');

let pool = null;

let user, password, database, port, host;

exports.init = async (opts={}) => {
	user = opts.user_name || user;
	password = opts.user_pass || password;
	database = opts.db_name || database;
	port = opts.port || port;
	host = opts.host || host;

	const whitelist = ['localhost', '', '127.0.0.1', '0.0.0.0'];

	if(!whitelist.includes(host)){
		throw Error('The given DB Host is not local, and the program will exit for safety.')
	}

	if(!pool){
		pool = mysql.createPool({
			host,
			port,
			user,
			password,
			database,
			waitForConnections: true,
			connectionLimit: 1,
			multipleStatements: true
		});
	}
};

exports.get_tables = async() => {
	return pool.query(`show tables;`)
};

exports.dump = async function (file, known_migrations) {
	return new Promise( async(resolve, reject) => {
		let temp = file + ".tmp";
		try {
			await mysqldump({
				connection: {
					host: host,
					port: port,
					user: user,
					password: password,
					database: database
				},
				dumpToFile: temp,
			});
			let data = {
				'key': 'known_migrations',
				'values': known_migrations
			};
			fs.appendFileSync(temp, `/* ${JSON.stringify(data, null, 2)} */`);
			if(fs.existsSync(file)) {
				fs.unlinkSync(file);
			}
			fs.renameSync(temp, file);
			resolve(true);
		}catch(err){
			if(fs.existsSync(temp)) {
				fs.unlinkSync(temp);
			}
			reject(err);
		}
	})
};


exports.destroy_db = async() => {
	return pool.query('DROP DATABASE IF EXISTS ' + database);
};

exports.create_db = async() => {
	await pool.query('CREATE DATABASE '+database);
	return await pool.query('USE ' + database);
};

/** Destroys the database itself, then recreates it. */
exports.recreate_db = async() => {
	await exports.destroy_db();
	return await exports.create_db();
};


exports.run_sql_file = async(path) => {
	return read_file(path).then( data => {
		return pool.query(data);
	});
};


function read_file(path){
	return new Promise( (resolve, reject) => {
		fs.readFile(path, "utf8", async(err, data) => {
			if(err) reject(err);
			resolve(data);
		});
	});
}

exports.read_config = async(path, key) => {
	return read_file(path).then( data => {
		return new Promise( (resolve, reject) => {
			match(data, /\/\*([\s\S]*?)\*\//gmi).forEach( ln => {
				try{
					if(ln.includes(key)){
						ln = ln.substring(ln.indexOf('{'), ln.lastIndexOf('}')+1);
						let obj = JSON.parse(ln);
						if(obj && obj.key === key){
							resolve(obj);
						}
					}
				}catch(e){console.error(e)}
			});
			reject("[Read Config]: Unable to locate config key: " + key + ', in file ' + path);
		})
	});
};


/**
 * Find and extract any table names references within the given SQL file.
 * This function uses some really hacky regex to try and extract dependancy tables & created table names.
 */
exports.getReferences = async(sqlFile) => {
	let sql = await read_file(sqlFile);
	return {
		'refs': match(sql, /REFERENCES[\s'"`]+(.+?)[\s'"`]/gmi),
		'creates': match(sql, /CREATE\sTABLE[\s'"`]+(.+?)[\s'"`]/gmi)
	}
};

const match = (sql, pattern) => {
	let m;
	let ret = [];
	while ((m = pattern.exec(sql)) !== null) {
		m.forEach((match, groupIndex) => {
			if(!groupIndex)return;
			ret.push(match);
		});
	}
	return ret;
};
