# db-stager

**This is a WIP.**

This project automates building and tearing down Docker images of MySQL. 

It grants you the ability to load entire Database structures from existing SQL Table files. There is built-in support for saving/reloading from SQL snapshot files, which it can generate at-will to save the tables+data of an entire database. The program also tracks any SQL migration files nested inside a selected directory, and can automatically apply any changes it finds as it loads previous snapshots.

This allows for automated unit tests to rapidly switch to (or rebuild) multiple database environments safely, with a very low impact on test suite speeds, while silmultaneously keeping every testing environment synchronized.

While running, the program exposes a local webserver+REST API, which allows users (or unit tests) to easily rebuild the database from snapshots simply by specifying the snapshot file name. The API also allows any testing suite to easily access a "shutdown" method, to terminate & clean up the database and Docker container.

## Requirements:
Node.js, and Docker (daemon installed & running). You do not need to have any Docker images pre-installed.

## Set Up:
Install the required Node packages by running ```npm install```.

Generate the configuration file by calling ```node ./indexex.js --build_config```. This will generate a configuration file with the default values set, and you are going to want to edit them before launch. You may also use command-line parameters, but these are not yet finalized or documented. See [config.js](./config.js).

## Running:
For now, the easiest way is to manually launch the server via ```node ./index.jsjs```. There is built-in support for importing as a Node library, but this needs further documentation, and the API is not yet finalized.


## Usage in Testing Frameworks:
*This is a sample way to use this application. Your mileage may vary.*

Since each test in most testing libraries is run within its own thread, and because starting the initial Docker container is somewhat slow for multiple unit tests, it is simplest to initialize the Docker container inside a [globalSetup/globalTeardown](https://jestjs.io/docs/en/configuration.html#globalsetup-string) file. 

__With Jest, this can be done like so:__
```js
// setup.js
const db = require('db-stager');
module.exports = async () => {
  await db.start(); //Run Docker container.
  // Set reference in order to close the server during teardown. Not required, but convenient.
  global.__DB__ = db;
};


// teardown.js
module.exports = async function() {
  await global.__DB__.stop(); // Shut down & clean up the running SQL Docker container.
  // We could use the control API as well, but in Jest this is more convenient.
};
```


Once the server has been launched, each unit test can individually access the control API it exposes, by doing the following:
```js
const {api} = require('db-stager');

await api.reload("saveName.sql"); // Load an existing save.
await api.save('outputSaveName.sql'); // Save the current database state to a file.
await api.terminate(); // Kill the whole Docker SQL server, moslty used in fringe cases.
```

### SQL Table Test Wrapper:

For convenience, there is also an included wrapper library for testing database Tables.
```js
const {Table} = require('db-stager').dbTester;

let tbl = new Table('table-name-from-loaded-db');
let existsCheck = await tbl.exists({field1: 'value1'}); // Check if a row exists with the given values, inside this table.

console.log('Row exists in table:', existsCheck);
```
