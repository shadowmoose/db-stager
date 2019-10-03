const http = require('http');
const args = require('../config');
const querystring = require('querystring');

const PORT = args.http_port;

const request = async(path, query={}) => {
    let qs = querystring.stringify(query);
    return new Promise( (resolve, reject) => {
        http.get(`http://localhost:${PORT}/${path}?${qs}`, (resp) => {
            let data = '';
            resp.on('data', (chunk) => {
                data += chunk;
            });
            resp.on('end', () => {
                resolve(data);
            });
        }).on("error", (err) => {
            reject(err);
        });
    });
}


/**
 * Tells the running server that it should reload the existing Database, using a given save file.
 * 
 * @param {String} fileName The name of the locally-saved SQL file to recreate tables from.
 */
const rebuild = async(fileName=null) => {
    return await request('rebuild_db', {file: fileName})
};


/**
 * Tells the running server that it should save the current Database state to the given file.
 * 
 * @param {String} fileName The name of the locally-saved SQL file to recreate tbales from.
 */
const save = async(fileName=null) => {
    return await request('save_db', {file: fileName})
};


/**
 * Completely shut down the currently-running server. The API will cease to function after this call.
 */
const terminate = async() => {
    return await request('terminate')
};


module.exports = {
    rebuild,
    load: rebuild,
    reload: rebuild,

    terminate,

    save
};
