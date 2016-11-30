'use strict';

const _ = require('lodash');
const bb = require('bluebird');
const AWS = require('aws-sdk');
const logger = require('../Logger.js');

class Route53Operator {
  constructor(options) {
    this.HostedZoneId = options.R53_HOSTED_ZONE_ID;
    this.r53 = bb.promisifyAll(new AWS.Route53(options), { suffix: 'Promised' });
  }

  getHostedZone(id) {
    return this.r53.getHostedZonePromised({
      Id: id,
    }).then((result) => {
      return result.HostedZone;
    });
  }

  changeResourceRecordSet(action, resourceRecordSet) {
    const Changes = [
      {
        Action: action,
        ResourceRecordSet: resourceRecordSet,
      },
    ];
    return this.r53.changeResourceRecordSetsPromised({
      HostedZoneId: this.HostedZoneId,
      ChangeBatch: {
        Changes
      },
    }).then((result) => {
      logger.info({Changes, result});
    }).catch((err) => {
      logger.error(err);
      return err;
    });
  }

  getResourceRecordSetsByIP(ipList) {
    return this.r53.listResourceRecordSetsPromised({
      HostedZoneId: this.HostedZoneId,
    }).then((result) => {
      return result.ResourceRecordSets.filter((ResourceRecordSet) => {
        return ResourceRecordSet.Type === 'A' && !_(ResourceRecordSet.ResourceRecords).filter((ResourceRecord) => {
          return !_(ipList).filter((ip) => {
            return ResourceRecord.Value === ip;
          }).isEmpty();
        }).isEmpty();
      });
    });
  }

  deleteRecordByIP(ipList) {
    return this.getResourceRecordSetsByIP(ipList).then((resourceRecordSets) => {
      const skipKeyword = '--master';
      return resourceRecordSets.map((resourceRecordSet) => {
        if (resourceRecordSet.Name.match(skipKeyword) !== null) {
          logger.info('skip by keyword', {name: resourceRecordSet.Name, keyword: skipKeyword})
          return ;
        }
        return this.changeResourceRecordSet('DELETE', resourceRecordSet);
      });
    });
  }

  createARecord(name, ip, ttl) {
    return this.getHostedZone(this.HostedZoneId).then((hostedZone) => {
      const resourceRecordSet = {
        Name: [name, hostedZone.Name].join('.'),
        Type: 'A',
        ResourceRecords: [
          {
            Value: ip,
          },
        ],
        TTL: ttl || 60,
      };
      return this.changeResourceRecordSet('CREATE', resourceRecordSet);
    });
  }

  deleteAndCreateARecord(name, ip, ttl) {
    return this.deleteRecordByIP([ip]).then(() => {
      return this.createARecord(name, ip, ttl)
    });
  }
}

module.exports = Route53Operator;
