# db-stager

**This is a WIP.**

This project automates building and tearing down of MySQL Databases, and supports starting entire temporary MySQL servers locally via Docker containers. 

It can load and save from the snapshot SQL files it creates, or build from scratch using existing SQL files that define table structures. As it saves and reloads, it can also track migration files, and apply any new migrations to your local database seamlessly.

While running, the program exposes a local REST API, which allows users (or unit tests) to instantly rebuild the database as-needed, loading structures and data from any snapshots it has saved.

This allows for automated unit tests to rapidly switch to (or rebuild) multiple database environments safely, with a very low impact on test suite speeds, while silmultaneously keeping every testing environment synchronized.

## Requirements:
Node.js, and Docker (daemon installed & running). You do not need to have any Docker images pre-installed.

## Installation & Set Up:
Install the required Node packages by running ```npm install db-stager```.

Generate the configuration file by calling ```db-stager --build_config```. This will generate a configuration file with the default values set, and you are going to want to edit them before launch. You may also use command-line parameters, but these are not yet finalized or documented. See [config.js](./config.js).


## Using db-stager in Testing Frameworks:
*This is a sample way to use this application. Your mileage may vary.*

Since each test in most testing libraries is run within its own thread, and because starting the initial Docker container is somewhat slow for multiple unit tests, it is simplest to initialize the Docker container inside a [globalSetup/globalTeardown](https://jestjs.io/docs/en/configuration.html#globalsetup-string) file. 

__With Jest, this can be done like so:__
```js
// setup.js
const db = require('db-stager');
module.exports = async () => {
  await db.start(); //Run Docker container. This can be a slow operation.
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

await api.reload("saveName.sql"); // Load an existing save. This is a fast operation.
await api.save('outputSaveName.sql'); // Save the current database state to a file.
await api.terminate(); // Kill the whole Docker SQL server.
await api.withLock(fnc); // Block until a lock is obtained, then run the given function.
```
If you'll be reloading databases between tests, make sure that your database-using tests are running single-threaded.
See the "Locking" section for more details.

### Exclusive Locking
Many testing suites will run your test function asynchronously. 
Historically, this has always been an issue when the tests each rely on a shared resource (in this case, the Database).

To help solve this problem, the db-stager API comes equipped with a server-wide Lock. 
This can be obtained on a local or remote db-stager server, and the Lock will be granted to exclusively one client at a time.

This is made simple in the client API, and can be used as follows:
```js
const {api} = require('./index');

// To obtain a Lock safely, as a Promise that automatically releases it when finished:
api.withLock(() => {
	// All code within this function can now run without worry of being interrupted.
	console.log('Obtained lock!');
    await api.reload('my-database');  // You can safely load and work exclusively with the database now.
	return 'test'
}).then( res => {
	// The lock is automatically released, even if an error occurs.
	console.log('Exited lock with value:', res); // returned value is passed through, will return 'test' in this case.
}).catch(err => {
	console.error('Caught error:', err) // All errors thrown will be passed through as well.
});

// Another option, if you want to directly use the Lock:
const release = await api.getLock();
// ... Do stuff here
release(); // Release the lock. Make sure this always gets called!
```

To avoid single clients holding the lock indefinitely, 
there are options on the server-side to specify a maximum Lock duration.

*Note: If you want to use the Lock system to run certain tests serially, make sure each test is wrapped in the Lock!*

### SQL Table Test Wrapper:

For convenience, there is also an included wrapper library for testing database Tables.
```js
const {Table} = require('db-stager').dbTester;

let tbl = new Table('table-name-from-loaded-db');
let existsCheck = await tbl.exists({field1: 'value1'}); // Check if a row exists with the given values, inside this table.

console.log('Row exists in table:', existsCheck);
```
