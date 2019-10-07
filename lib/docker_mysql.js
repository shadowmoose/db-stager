const config = require('../config').opts;
const {log} = require('./log');
let Docker = require('dockerode');
let docker = new Docker(); //defaults to above if env variables are not used


const default_prefix = 'test-db';

class DockerWrapper {
	constructor(){
		this.containerTag = config.docker_mysql || 'mysql:5.7.26';
		this.prefix = config.docker_prefix || default_prefix;
		this.container = null;
	}

	async pull(){
		let stream = await docker.pull(this.containerTag);
		return new Promise((resolve, reject) => {
			let downloading = false;
			let len = Math.min(process.stdout.columns - 20, 50);
			docker.modem.followProgress(stream, (err, res) => err ? reject(err) : resolve(downloading), stat => {
				if(!downloading && stat.status.toLowerCase().includes('pulling fs layer')){
					log.info("Pulling Docker image that is not cached (yet). This is first-time-only setup, and might take a while...");
					downloading = true;
				}else if(downloading){
					process.stdout.write(stat.status.substring(0, len).padEnd(len, '.') + '\r');
				}
			});
		});
	}

	async create(){
		let downloaded = await this.pull();
		if(downloaded) log.info();
		log.debug("Booting docker SQL container...");
		return docker.createContainer({
			Image: this.containerTag,
			name: `${this.prefix}-local-mysql`,
			AttachStdin: false,
			AttachStdout: true,
			AttachStderr: true,
			OpenStdin: false,
			StdinOnce: false,
			Env: [
				`MYSQL_ROOT_PASSWORD=${config.sql_root_pass}`,
				`MYSQL_DATABASE=${config.sql_db}`,
				`MYSQL_USER=${config.sql_user}`,
				`MYSQL_PASSWORD=${config.sql_pass}`
			],
			ExposedPorts: { "3306/tcp": {} },
			HostConfig: {
				PortBindings: { "3306/tcp": [{ "HostPort": `${config.sql_port}`, "HostIp": config.sql_host }] }
			},
			Labels: {
				"created_by": this.prefix
			}
		}).then((cont) => {
			this.container = cont;
			return cont.start()
		}).then( () => {
			// wait for container to log that it is ready.
			return new Promise( (resolve, reject) => {
				setTimeout(()=>{reject('Wait for MySQL Docker container timed out.')}, 30000);
				this.container.attach({stream: true, stdout: true, stderr: true}, (err, stream) => {
					let data ='';
					let chunk;
					stream.setEncoding('utf8');
					stream.on('readable', () => {
						while ((chunk=stream.read()) !=null) {
							data += chunk.toLowerCase();
						}
						if((data.match(/ready for connections/g) || []).length > 1 && data.includes('init process done')){
							stream.destroy();
							resolve(true);
						}
					});
				});
			});
		});
	}

	async stop(){
		if(!this.container) throw Error("This Docker container was never started.");
		await this.container.stop();
		await this.container.remove();
	}

	async purge(){
		log.debug("Searching for old docker containers....");
		let containers = await docker.listContainers({all: true});
		let proms = containers.map((containerInfo) => {
			if(!containerInfo.Labels || containerInfo.Labels.created_by !== this.prefix)
				return;
			let cont = docker.getContainer(containerInfo.Id);
			let pr = containerInfo.State === 'running' ? cont.stop() : Promise.resolve();
			pr.then(() => {
				cont.remove()
			}).then(() => {
				log.debug(`Terminated old container: ${containerInfo.Names[0]}`)
			});
			return pr
		});
		return Promise.all(proms);
	}
}

exports.Docker = DockerWrapper;
