const http = require('http');
const args = require('../config').opts;
const querystring = require('querystring');
const WebSocket = require('ws');


const request = async(path, query={}) => {
    let qs = querystring.stringify(query);
    return new Promise( (resolve, reject) => {
        http.get(`http://${args.http_host}:${args.http_port}/${path}?${qs}`, (resp) => {
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
};


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

/**
 * Obtain sole ownership of a server-wide Lock. Be sure to close this!
 *
 * @returns {function} The release() function, which will release the Lock.
 */
const getLock = async() => {
    return new Promise( (resolve, reject) => {
        const ws = new WebSocket(`ws://${args.http_host}:${args.http_port}/lock`);
        ws.on('message', (data)=>{
            resolve(()=>{ws.close()})
        });
        ws.on('close', ()=>{
            reject('Disconnected from server while awaiting Lock!')
        });
        ws.on('error', (err)=>{
            reject('Encountered error while awaiting Lock: ' + err)
        });
    })
};


/**
 * Obtains sole server-wide ownership of the Database API Lock, runs the given function, and releases the lock.
 * Does not handle error catching.
 *
 * @param fnc The callback - possibly async - to run before freeing the Lock.
 * @returns {object} The result of running the callback.
 */
const withLock = async(fnc) => {
    let release = await getLock();
    try{
        return await fnc();
    }finally{
        release();
    }
};


module.exports = {
    rebuild,
    load: rebuild,
    reload: rebuild,

    terminate,

    getLock,
    withLock,

    save
};
