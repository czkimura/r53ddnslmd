'use strict';

const _ = require('lodash');
const dotenv = require('dotenv-safe');
const logger = require('./Logger');
const R53Operator = require('./Operators/Route53Operator');
const EC2Operator = require('./Operators/EC2Operator');
const DDNSStorage = require('./Storages/S3Storage');

class R53ddnslmd {
  constructor(conf) {
    this.configure(_.isUndefined(conf) ? dotenv.load() : conf);
  }

  configure(conf) {
    this.conf = conf;
    this.ec2op = new EC2Operator(conf);
    this.r53op = new R53Operator(conf);
    this.ddns = new DDNSStorage(conf);
  }

  terminatedHandler(event) {
    return this.ddns.restoreInfo('EC2', event.detail['instance-id']).then((instance) => {
      return this.r53op.deleteRecordByIP([instance.PrivateIpAddress]);
    }).then((promiseList) => {
      return Promise.all(promiseList);
    });
  }

  wakeupHandler(event) {
    return this.ec2op.getInstance(event.detail['instance-id']).then((instance) => {
      const hostName = this.constructor.generateHostName(instance);
      return this.r53op.deleteAndCreateARecord(hostName, instance.PrivateIpAddress).then((result) => {
        return Promise.all([
          result,
          this.ddns.storeInfo('EC2', instance.InstanceId, instance),
          this.ddns.storeHost('EC2', instance.InstanceId, hostName),
        ]);
      });
    });
  }

  mainHandler(event, context) {
    let promise;
    if (event.detail.state === 'terminated'
      || event.detail.state === 'stopped') {
      promise = this.terminatedHandler(event);
    } else if (event.detail.state === 'running') {
      promise = this.wakeupHandler(event);
    } else {
      promise = Promise.resolve(event);
    }
    promise.then((results) => {
      logger.info(results);
      context.succeed(results);
    }).catch((err) => {
      logger.error(err);
      context.fail(err);
    });
  }

  getMainHandler() {
    return this.mainHandler.bind(this);
  }

  static generateHostName(instance) {
    return instance.Tags.reduce((prev, tag) => {
      if (prev) { return prev; }
      return tag.Key === 'Name' ? tag.Value : prev;
    }, false) || instance.InstanceId;
  }
}

module.exports = R53ddnslmd;
