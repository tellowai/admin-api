'use strict';

const proxyquire = require('proxyquire');
const sinon = require('sinon');
const { expect } = require('chai');

describe('SDUI BFF Resources Model', () => {
  let sduiBffResourcesModel;
  let mysqlQueryRunnerMock;

  beforeEach(() => {
    mysqlQueryRunnerMock = {
      runQueryInSlave: sinon.stub(),
      runQueryInMaster: sinon.stub(),
    };

    sduiBffResourcesModel = proxyquire('../../../modules/sdui/models/sdui.bff-resources.model', {
      '../../core/models/mysql.promise.model': mysqlQueryRunnerMock,
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('listBffResources', () => {
    it('should query bff resources', async () => {
      mysqlQueryRunnerMock.runQueryInSlave.resolves([{ resource_key: 'credits_history' }]);
      const result = await sduiBffResourcesModel.listBffResources();
      expect(result).to.deep.equal([{ resource_key: 'credits_history' }]);
    });
  });

  describe('createBffResource', () => {
    it('should create a new bff resource', async () => {
      mysqlQueryRunnerMock.runQueryInMaster.resolves({ insertId: 'uuid' });
      await sduiBffResourcesModel.createBffResource({
        resource_key: 'credits_history',
        display_name: 'Credits History',
        domain_service: 'credits',
        service_method: 'getHistory'
      });
      expect(mysqlQueryRunnerMock.runQueryInMaster.calledOnce).to.be.true;
    });
  });
});
