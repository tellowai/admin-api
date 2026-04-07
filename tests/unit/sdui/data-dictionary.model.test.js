'use strict';

const proxyquire = require('proxyquire');
const sinon = require('sinon');
const { expect } = require('chai');

describe('SDUI Data Dictionary Model', () => {
  let sduiDataDictionaryModel;
  let mysqlQueryRunnerMock;

  beforeEach(() => {
    mysqlQueryRunnerMock = {
      runQueryInSlave: sinon.stub(),
      runQueryInMaster: sinon.stub(),
    };

    sduiDataDictionaryModel = proxyquire('../../../modules/sdui/models/sdui.data-dictionary.model', {
      '../../core/models/mysql.promise.model': mysqlQueryRunnerMock,
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('listDataDictionaryFields', () => {
    it('should list fields by resourceKey', async () => {
      mysqlQueryRunnerMock.runQueryInSlave.resolves([{ id: '1', field_path: 'amount' }]);
      
      const result = await sduiDataDictionaryModel.listDataDictionaryFields('credits_history');
      
      expect(result).to.deep.equal([{ id: '1', field_path: 'amount' }]);
      expect(mysqlQueryRunnerMock.runQueryInSlave.calledOnce).to.be.true;
      const args = mysqlQueryRunnerMock.runQueryInSlave.getCall(0).args;
      expect(args[0]).to.include('WHERE resource_key = ?');
      expect(args[1]).to.deep.equal(['credits_history']);
    });
  });

  describe('createDataDictionaryField', () => {
    it('should insert a new dictionary field', async () => {
      mysqlQueryRunnerMock.runQueryInMaster.resolves({ insertId: 'new_uuid' });
      
      const data = {
        resource_key: 'credits_history',
        field_path: 'amountDisplay',
        field_type: 'string',
        display_name: 'Amount Display',
      };
      
      const id = await sduiDataDictionaryModel.createDataDictionaryField(data);
      
      expect(id).to.be.a('string');
      expect(mysqlQueryRunnerMock.runQueryInMaster.calledOnce).to.be.true;
      const args = mysqlQueryRunnerMock.runQueryInMaster.getCall(0).args;
      expect(args[0]).to.include('INSERT INTO sdui_data_dictionary');
      expect(args[1]).to.include('credits_history');
      expect(args[1]).to.include('amountDisplay');
    });
  });
});
