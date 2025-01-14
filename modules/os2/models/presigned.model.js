var {
  runQueryInMaster: RunCHQueryInMaster,
  runQueryingInSlave: RunCHQueryingInSlave
} = require('../../core/models/clickhouse.promise.model');


exports.insertUploadPresignedURLGeneration = async function (urlsData) {
  const columns = Object.keys(urlsData[0]).join(', ');
  const values = urlsData.map(data => Object.values(data).map(value => typeof value === 'string' ? `'${value}'` : `'${value}'`).join(', ')).join('), (');
  
  const query = `
    INSERT INTO os2_presigned_url_generations
    (${columns})
    VALUES
    (${values})
  `;

  return await RunCHQueryInMaster(query);  
};
