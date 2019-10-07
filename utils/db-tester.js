const mysql = require('mysql2/promise');
const config = require('../config').opts;


let pool = null;

const init = async () => {
    if(!pool){
        pool = mysql.createPool({
            host: config.sql_host,
            port: config.sql_port,
            user: config.sql_user,
            password: config.sql_pass,
            database: config.sql_db,
            waitForConnections: true,
            connectionLimit: 5,
            multipleStatements: true,
            namedPlaceholders: true
        });
        await pool.query('USE ' + config.sql_db);
    }
    return pool;
};


/**
 * Accepts a variety of inputs, and parses them into a single "WHERE" MySQL String.
 *
 * __WHERE can be:__
 *    String: representing the raw "where" section of the SQL query,
 *    Array[String]: an array of "Key<>=Value" comparison clauses, using standard SQL methods
 *    Object: A group of "key=value" pairs. Only supports "=" for comparison of these.
 * @param {String|Array|Object} inputWhere
 * @param {Object} inputParams
 */
const parseWhere = (inputWhere, inputParams={}) => {
    let where = inputWhere? JSON.parse(JSON.stringify(inputWhere)) : '';
    let params = inputParams? JSON.parse(JSON.stringify(inputParams)) : {};
    if(typeof where === 'object' && !Array.isArray(where)){
        let st = [];
        let idx = 0;
        for(let k in where){
            let v = where[k];
            let sk = k? k.replace(/[\W_]+/g,"") : k;
            if(!sk || sk in params) sk = 'param-'+(idx++);
            params[sk] = v;
            st.push(`${k} = :${sk}`);
        }
        where = st;
    }
    if(Array.isArray(where)){
        where = where.join(' AND ');
    }
    if (where && (typeof where === 'string' || where instanceof String)){
        where = where.trim().toUpperCase().startsWith('WHERE')? where : `WHERE ${where}`;
    }
    return {
        where,
        params
    }
};


const query = async(sql, params={}, stripExt=true) => {
    await init();
    console.debug(sql, JSON.stringify(params));
    let ret = await pool.query(sql, params)
    return stripExt ? ret[0] : ret;
};

const exists = async(table, where, params={}) => {
    let parsed = parseWhere(where, params);
    let ex = await query(`SELECT EXISTS(SELECT * FROM ${table} ${parsed.where}) AS ex`, parsed.params);
    return ex[0]['ex'];
};

const count = async(table, where, params={}) => {
    let parsed = parseWhere(where, params);
    return query(`SELECT COUNT(*) FROM ${table} ${parsed.where}`, parsed.params)
};

const select = async(table, where, params={}, order_by='', limit=0) => {
    let parsed = parseWhere(where, params);
    let lim = limit? `LIMIT ${limit}` : '';
    let order = order_by? `ORDER BY ${order_by}` : '';
    return query(`SELECT * FROM ${table} ${parsed.where} ${order} ${lim}`, parsed.params)
};


class Table{
    constructor(name){
        this.name = name;
        this.verified = false;
    }

    /**
     * Validate that this table exists. 
     * Called automatically when any SQL commands are run through this object.
     * After running, *this.verified* will be *true* if this table is valid.
     * 
     * Throws an Error if the table lookup fails.
     */
    async validateTable(){
        if(this.verified) return true;
        let res = await exists('information_schema.tables', {
            table_schema: config.sql_db,
            table_name: this.name
        });
        this.verified = res;
        if(!res) throw new Error(`The table '${config.sql_db}.${this.name}' does not exist!`);
        return res;
    }

    /**
     * Run a direct query on this database, using a manually-written SQL string.
     * 
     * @param {String} sql The SQL string to run on the active database.
     * @param {Object} params A list of key->values, which map to placeholders in the SQL.
     */
    async query(sql, params={}){
        await this.validateTable();
        return query(sql, params);
    }

    /**
     * Returns the count of all rows in this Table matching the given query.
     * 
     * See *parseWhere()* for more details about the inputs.
     * @param {*} where 
     * @param {*} params 
     */
    async count(where, params={}){
        await this.validateTable();
        return count(this.name, where, params);
    }

    /**
     * Returns Truthy/Falsy, if any rows exist in this Table for the given query.
     * 
     * This uses SQL's *EXISTS()* functionality, so is faster than *count* or *select*.
     * @param {*} where 
     * @param {*} params 
     */
    async exists(where, params={}){
        await this.validateTable();
        return exists(this.name, where, params);
    }

    /**
     * Query this table for an array of matching rows. 
     * 
     * Always returns an array, but it may be empty if no matches were found.
     * 
     * See *parseWhere()* for more details about the inputs.
     * @param {*} where 
     * @param {*} params 
     * @param {String} order_by A MySQL-formatted order string, missing 'ORDER BY'.
     * @param {Number} limit The maximum amount of rows to fetch. Use <1 for unlimited.
     */
    async select(where, params={}, order_by='', limit=0){
        await this.validateTable();
        return select(this.name, where, params, order_by, limit);
    }

    /**
     * The same as *this.query()*, except this returns a single object instead of an array.
     * 
     * Returns **null** if no row is found.
     * 
     * @param {*} where 
     * @param {*} params 
     * @param {String} order_by A MySQL-formatted order string, missing 'ORDER BY'.
     */
    async selectOne(where, params, order_by=''){
        let ret = await this.select(where, params, order_by, 1);
        return ret.length? ret[0] : null;
    }
}


module.exports = {
    init,
    query,
    exists,
    count,
    Table
};
