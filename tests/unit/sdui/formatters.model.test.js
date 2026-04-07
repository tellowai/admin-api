'use strict';

const proxyquire = require('proxyquire');
const sinon = require('sinon');
const { expect } = require('chai');

describe('SDUI Formatters Model', () => {
  let sduiFormattersModel;
  let mysqlQueryRunnerMock;

  beforeEach(() => {
    mysqlQueryRunnerMock = {
      runQueryInSlave: sinon.stub(),
      runQueryInMaster: sinon.stub(),
    };

    sduiFormattersModel = proxyquire('../../../modules/sdui/models/sdui.formatters.model', {
      '../../core/models/mysql.promise.model': mysqlQueryRunnerMock,
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('getFormatters', () => {
    it('should list formatters by resource', async () => {
      mysqlQueryRunnerMock.runQueryInSlave.resolves([{ formatter_name: 'Date fmt' }]);
      const res = await sduiFormattersModel.getFormatters('credits');
      expect(res).to.have.length(1);
    });
  });
});
