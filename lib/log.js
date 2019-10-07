const winston = require('winston');
const { combine, timestamp, label, printf } = winston.format;

const transports = {
	console: new winston.transports.Console({ level: 'warn', json: false })
};

const basicFormat = printf(({ level, message, label, timestamp }) => {
	return `${timestamp} [${label}] ${level}: ${message}`;
});

const logger = winston.createLogger({
	format: combine(
		label({ label: 'db-stager' }),
		timestamp(),
		basicFormat
	),
	transports: [
		transports.console
	]
});


transports.console.level = 'info';
module.exports = {
	log: logger,
	transports
};
