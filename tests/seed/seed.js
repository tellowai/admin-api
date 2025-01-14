// seed.js

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2');
var dbConfigData= require('../../database.json');


const dbConfig = {
  host: dbConfigData.test.host,
  user: dbConfigData.test.user,
  password: dbConfigData.test.password,
  database: dbConfigData.test.database,
};

// Read the SQL file
const sqlFilePath = path.join(__dirname, '../../migrations/seed/seed_data.sql');
const sql = fs.readFileSync(sqlFilePath, 'utf8');
const sqlStatements = sql.split(';').filter((statement) => statement.trim() !== '');

// Create a MySQL connection pool
const pool = mysql.createPool(dbConfig);

// Execute the SQL statements one by one
const executeSql = async () => {
  for (const statement of sqlStatements) {
    try {
      await pool.promise().query(statement);
      console.log('Query executed successfully:', statement);
    } catch (error) {
      console.error('Error executing query:', statement);
      console.error('Error details:', error);
    }
  }
  // Close the connection pool
  pool.end();
};

// Call the executeSql function
executeSql();
