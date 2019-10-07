const glob = require("glob");
const crypto = require('crypto');
const fs = require('fs');
const minify = require('pg-minify');


exports.findAll = (baseDir) => {
    return new Promise( (resolve => {
        glob(`${baseDir}/**/*.sql`, async (er, files) => {
            if(er) throw er;
            files.sort();
            let res = files.map( async(f)=> {
                return {
                    file: f,
                    hash: await sqlHash(f)
                };
            });
            resolve(await Promise.all(res));
        })
    }))
};


/**
 * Reads the given SQL file & returns the hash of all meaningful data.
 * 
 * This function automatically strips whitespace and comments before hashing,
 * which allows the hash to ignore inconsequential changes that do not impact the database.
 * 
 * @param {string} filename The file to hash.
 * @param {string} algorithm The algorithm to use, default sha256.
 */
function sqlHash(filename, algorithm = 'sha256') {
    return new Promise((resolve, reject) => {
        try {
            fs.readFile(filename, 'utf-8', function read(err, data) {
                if (err) {
                    throw err;
                }
                const sql = minify(data, {compress: true});
                const hash = crypto.createHash(algorithm).update(sql, "binary").digest("base64");
                return resolve(hash);
            });
        } catch (error) {
            reject(error);
        }
    });
}
