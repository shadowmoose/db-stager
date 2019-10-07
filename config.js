const commandLineArgs = require('command-line-args');
const yaml = require('js-yaml');
const fs   = require('fs');

const optionDefinitions = [
	{ name: 'help', alias: 'h', type: Boolean, default: false, desc: 'Print help message and exit.'},
	{ name: 'build_config', alias: 'b', type: Boolean, default: false, desc: 'Generate a config file with these options.'},
	{ name: 'http_port', type: Number, default: 3001, desc: 'The port to open/access a HTTP control panel over.'},
	{ name: 'http_host', type: String, default: 'localhost', desc: 'The host to open/access a HTTP control panel over.'},
	{ name: 'http_max_lock_ms', type: Number, default: 0, desc: 'The maximum time, in milliseconds, that a client may own the API Lock.'},
	{ name: 'sql_port', type: String, default: '3306', desc: 'The port to expose for MySQL.'},
	{ name: 'sql_host', type: String, default: '0.0.0.0', desc: 'The Host to use for the temporary MySQL server.'},
	{ name: 'sql_root_pass', alias: 'r', type: String, default: 'root', desc: 'Password for the `root` MySQL account.'},
	{ name: 'sql_db', alias: 'd', type: String, default: 'test_db', desc: 'The name of the database to create.'},
	{ name: 'sql_user', alias: 'u', type: String, default: 'user', desc: 'The username of the non-root MySQL user to create.'},
	{ name: 'sql_pass', alias: 'p', type: String, default: 'password', desc: 'The password for the non-root MySQL user.'},
	{ name: 'save_file', alias: 's', type: String, default: './db-test.sql', desc: 'The output file for saving/loading the staged Database.', defaultOption: true},
	{ name: 'migrations', alias: 'm', type: String, default: './db/modifications/', desc: 'The base directory containing all SQL migration files.'},
	{ name: 'tables', alias: 't', type: String, default: null, desc: 'The base directory containing all SQL Table Schemas. Overrides `save_file`, if set.'},
	{ name: 'config_file', alias: 'c', type: String, default: './.db-stager-config.yml', desc: 'The path to the configuration file.'},
	{ name: 'use_docker', type: Boolean, default: true, desc: 'If a Docker container should be started to host the given SQL server.'},
	{ name: 'docker_prefix', type: String, default: 'staging-tool', desc: 'Prefix all docker containers with this. Useful for concurrent setups.'},
	{ name: 'docker_mysql', type: String, default: 'mysql:5.7.26', desc: 'The full Docker tag of the MYSQL Image to use.'}
].sort((a, b) => (a.name > b.name) ? 1 : -1);


let args = {};
let loadedConfig = null;
let configured = {};


const get = (opt) => {
	if(loadedConfig === null) {
		const loadFile = args[loadedConfig] || getDef('config_file');
		loadedConfig = fs.existsSync(loadFile)? yaml.safeLoad(fs.readFileSync(loadFile, 'utf8')) : {};
	}
	return configured[opt] || args[opt] || loadedConfig[opt] || getDef(opt);
};

function getDef(opt){
	let op = optionDefinitions.find(o=>o.name === opt);
	if(!op) throw Error('Unable to locate config option: ' + opt);
	return op.default;
}

/**
 * Parse input Command Line Arguments into configuration values.
 * Automatically exits if a help message or config file build is triggered.
 */
function parseFromArgs() {
	args = commandLineArgs(optionDefinitions);

	if (get('help')) {
		console.log("Parameter Usage Guide:");
		for (let k of optionDefinitions) {
			let name = k.name;
			let alias = k.alias ? ',-' + k.alias : '';
			let deff = k.type !== Boolean ? `(${get(k.name)})` : '';
			console.log('\t', `[--${name}${alias}]`, deff, k.desc);
		}
		process.exit(0);
	}

	if (get('build_config')) {
		let file = get('config_file');
		if (fs.existsSync(file)) throw Error(`Error: Cannot safely generate config file - one already exists at "${file}"!`);
		let skip = ['help', 'build_config', 'config_file', 'tables'];
		let out = '';
		for (let o of optionDefinitions) {
			if (skip.includes(o.name)) continue;
			let ob = {};
			ob[o.name] = get(o.name);
			let val = yaml.dump(ob);
			out += `# ${o.desc}\n${val}\n`;
		}
		fs.writeFileSync(file, out);
		console.log("Generated config file: " + file);
		process.exit(0);
	}
}

/**
 * Use the given key/values as settings in the configuration.
 * The possible inputs match the Command Line arguments.
 *
 * @param opts Object of key/value pairs.
 */
function configure(opts={}){
	Object.assign(configured, opts);
}

let handler = {
	get: function(proxy, name) {
		return get(name);
	},
	set: function(p, name){
		throw Error(`Attempted to reset config's "${name}" value. Not allowed!`)
	}
};


module.exports = {
	opts: new Proxy({}, handler),
	parseFromArgs,
	configure
};
