'use strict';

var async = require('async');
var bitcore = require('bitcore-lib');
var _ = bitcore.deps._;
var pools = require('../pools.json');
var BN = bitcore.crypto.BN;
var LRU = require('lru-cache');
var Common = require('./common');

function BlockController(options) {
  var self = this;
  this.node = options.node;
 
  this.blockSummaryCache = LRU(options.blockSummaryCacheSize || BlockController.DEFAULT_BLOCKSUMMARY_CACHE_SIZE);
  this.blockCacheConfirmations = 6;
  this.blockCache = LRU(options.blockCacheSize || BlockController.DEFAULT_BLOCK_CACHE_SIZE);

  this.poolStrings = {};
  pools.forEach(function(pool) {
    pool.searchStrings.forEach(function(s) {
      self.poolStrings[s] = {
        poolName: pool.poolName,
        url: pool.url
      };
    });
  });

  this.common = new Common({log: this.node.log});
}

var BLOCK_LIMIT = 200;

BlockController.DEFAULT_BLOCKSUMMARY_CACHE_SIZE = 1000000;
BlockController.DEFAULT_BLOCK_CACHE_SIZE = 1000;

function isHexadecimal(hash) {
  if (!_.isString(hash)) {
    return false;
  }
  return /^[0-9a-fA-F]+$/.test(hash);
}

BlockController.prototype.checkBlockHash = function(req, res, next) {
  var self = this;
  var hash = req.params.blockHash;
  if (hash.length < 64 || !isHexadecimal(hash)) {
    return self.common.handleErrors(null, res);
  }
  next();
};

/**
 * Find block by hash ...
 */
BlockController.prototype.block = function(req, res, next) {
  var self = this;
  var hash = req.params.blockHash;
  var blockCached = self.blockCache.get(hash);
  if (blockCached) {
    blockCached.confirmations = self.node.services.bitcoind.height - blockCached.height + 1;
    req.block = blockCached;
    next();
  } else {
    self.node.getBlock(hash, function(err, block) {
    	if((err && err.code === -5) || (err && err.code === -8)) {
            return self.common.handleErrors(null, res);
          } else if(err) {
            return self.common.handleErrors(err, res);
          }
      var rightHash=null;
      if(block.value){
    	  var rightHash=block.hash;
    	  block=block.value;
      }
      self.node.getInfo(function(err, info) {
    	  var maxHeight=info.blocks;
    	  var blockResult = self.transformBlocIncludeConfirmTimes(block,maxHeight);
          if (blockResult.confirmations >= self.blockCacheConfirmations) {
            self.blockCache.set(hash, blockResult);
          }
          req.block = blockResult;
          if(rightHash){
        	  req.block.hash=rightHash;	
          }else{
        	  req.block.hash=hash;
          }
          next();
      });
    });
  }
};

/**
 * Find rawblock by hash and height...
 */
BlockController.prototype.rawBlock = function(req, res, next) {
  var self = this;
  var blockHash = req.params.blockHash;

  self.node.getRawBlock(blockHash, function(err, blockBuffer) {
    if((err && err.code === -5) || (err && err.code === -8)) {
      return self.common.handleErrors(null, res);
    } else if(err) {
      return self.common.handleErrors(err, res);
    }
    req.rawBlock = {
      rawblock: blockBuffer.toString('hex')
    };
    next();
  });

};

BlockController.prototype._normalizePrevHash = function(hash) {
  // TODO fix bitcore to give back null instead of null hash
  if (hash !== '0000000000000000000000000000000000000000000000000000000000000000') {
    return hash;
  } else {
    return null;
  }
};

BlockController.prototype.transformBlocIncludeConfirmTimes = function(block,maxHeight) {

	  var blockObj = block.toObject();
	  var transactionIds = blockObj.transactions.map(function(tx) {
	    return tx.hash;
	  });
	  return {
	    hash: block.hash,
	    size: block.toBuffer().length,
	    height: blockObj.header.height,
	    version: blockObj.header.version,
	    merkleroot: blockObj.header.merkleRoot,
	    tx: transactionIds,
	    time: blockObj.header.time,
	    nonce: blockObj.header.nonce,
	    bits: blockObj.header.bits.toString(16),
	    difficulty: block.header.getDifficulty(),
	    chainwork: '',
	    confirmations: parseInt(maxHeight)-parseInt(blockObj.header.height)+1,
	    previousblockhash: this._normalizePrevHash(blockObj.header.prevHash),
	    nextblockhash: blockObj.header.nextHash,
	    reward: this.getBlockReward(blockObj.header.height) / 1e8,
	    isMainChain: ((parseInt(maxHeight)-parseInt(blockObj.header.height)+1) !== -1),
	    poolInfo: this.getPoolInfo(block)
	  };
	};

BlockController.prototype.transformBlock = function(block) {
  var blockObj = block.toObject();
  var transactionIds = blockObj.transactions.map(function(tx) {
    return tx.hash;
  });
  return {
    hash: block.hash,
    size: block.toBuffer().length,
    height: blockObj.header.height,
    version: blockObj.header.version,
    merkleroot: blockObj.header.merkleRoot,
    tx: transactionIds,
    time: blockObj.header.time,
    nonce: blockObj.header.nonce,
    bits: blockObj.header.bits.toString(16),
    difficulty: block.header.getDifficulty(),
    chainwork: '',
    confirmations: blockObj.header.confirmations,
    previousblockhash: this._normalizePrevHash(blockObj.header.prevHash),
    nextblockhash: blockObj.header.nextHash,
    reward: this.getBlockReward(blockObj.header.height) / 1e8,
    isMainChain: (blockObj.header.confirmations !== -1),
    poolInfo: this.getPoolInfo(block)
  };
};

/**
 * Show block
 */
BlockController.prototype.show = function(req, res) {
	if (req.block) {
	
	  res.jsonp(req.block);
  }
};

BlockController.prototype.showRaw = function(req, res) {
  if (req.rawBlock) {
    res.jsonp(req.rawBlock);
  }
};

BlockController.prototype.blockIndex = function(req, res) {
  var self = this;
  var height = req.params.height;

  this.node.getBlockHashByHeight(parseInt(height), function(err, info) {
    if (err) {
      return self.common.handleErrors(err, res);
    }
    res.jsonp({
      blockHash: info.hash
    });
  });
};

BlockController.prototype._getBlockSummary = function(hash, moreTimestamp, next) {
  var self = this;

  function finish(result) {
    if (moreTimestamp > result.time) {
      moreTimestamp = result.time;
    }
    return next(null, result);
  }

  var summaryCache = self.blockSummaryCache.get(hash);

  if (summaryCache) {
    finish(summaryCache);
  } else {
    self.node.services.bitcoind.getRawBlock(hash, function(err, blockBuffer) {
      if (err) {
        return next(err);
      }

      var br = new bitcore.encoding.BufferReader(blockBuffer);

      // take a shortcut to get number of transactions and the blocksize.
      // Also reads the coinbase transaction and only that.
      // Old code parsed all transactions in every block _and_ then encoded
      // them all back together to get the binary size of the block.
      // FIXME: This code might still read the whole block. Fixing that
      // would require changes in bitcore-node.
      var header = bitcore.BlockHeader.fromBufferReader(br);
      var info = {};
      var txlength = br.readVarintNum();
      info.transactions = [bitcore.Transaction().fromBufferReader(br)];

      self.node.services.bitcoind.getBlockHeader(hash, function(err, blockHeader) {
        if (err) {
          return next(err);
        }
        var height = blockHeader.height;

        var summary = {
          height: height,
          size: blockBuffer.length,
          hash: hash,
          time: header.time,
          txlength: txlength,
          poolInfo: self.getPoolInfo(info)
        };

        var confirmations = self.node.services.bitcoind.height - height + 1;
        if (confirmations >= self.blockCacheConfirmations) {
          self.blockSummaryCache.set(hash, summary);
        }

        finish(summary);
      });
    });

  }
};

BlockController.prototype.TomorrowIsTodayAfter8Hour = function(){
	var now = new Date();
	var _8Hour = new Date(now.getTime() +28800000);
	if(now.getUTCDate() < _8Hour.getUTCDate()){
		return _8Hour;
	}else{
		return now;
	}
}

// List blocks by date
BlockController.prototype.list = function(req, res) {
  var self = this;

  var dateStr;
  var todayStr = this.formatTimestamp(this.TomorrowIsTodayAfter8Hour());
  var isToday;
  if (req.query.blockDate) {
    dateStr = req.query.blockDate;
    var datePattern = /\d{4}-\d{2}-\d{2}/;
    if(!datePattern.test(dateStr)) {
      return self.common.handleErrors(new Error('Please use yyyy-mm-dd format'), res);
    }
    isToday = dateStr === todayStr;
  } else {
    dateStr = todayStr;
    isToday = true;
  }

  var lte = parseInt(parseInt(req.query.startTimestamp))|| Math.round((new Date(dateStr).getTime()) / 1000+86400 - 8*60*60 -1);//greater than this one
  var gte =Math.round((new Date(dateStr)).getTime() / 1000 - 8*60*60 );
  var prev = this.formatTimestamp(new Date((Math.round((new Date(dateStr)).getTime() / 1000) - 86400 ) * 1000));
  var next = isToday ? null: this.formatTimestamp(new Date((Math.round((new Date(dateStr)).getTime() / 1000) + 86400 ) * 1000 + 1));

//  var lte = parseInt(parseInt(req.query.startTimestamp))|| Math.round((new Date(dateStr).getTime()) / 1000+86400  -1);//greater than this one
//  var gte =Math.round((new Date(dateStr)).getTime() / 1000 );
//  var prev = this.formatTimestamp(new Date((Math.round((new Date(dateStr)).getTime() / 1000) - 86400 ) * 1000));
//  var next = isToday ?null: this.formatTimestamp(new Date((Math.round((new Date(dateStr)).getTime() / 1000) + 86400 ) * 1000 + 1));
  
  var limit = parseInt(req.query.limit || BLOCK_LIMIT);
  
  var more = false;
  var moreTimestamp = lte;
  self.node.services.bitcoind.getBlockHashesByTimestamp(lte, gte, function(err, data) {
    if(err) {
      return self.common.handleErrors(err, res);
    }
    var blocks=data.result;
    if(blocks.length > limit) {
      more = true;
      blocks = blocks.slice(0, limit);
      moreTimestamp=blocks[blocks.length-1].time;
    }
    for(var i=0;i<blocks.length;i++){
    	blocks[i].txlength=blocks[i].txLength;
    }
    var data = {
          blocks: blocks,
          length: blocks.length,
          pagination: {
            next: next,
            prev: prev,
            currentTs: lte - 1,
            current: dateStr,
            isToday: isToday,
            more: more,
            moreTs: moreTimestamp
          }
    };
    res.jsonp(data);
  });
};

BlockController.prototype.getPoolInfo = function(block) {
  var coinbaseBuffer = block.transactions[0].inputs[0]._scriptBuffer;

  for(var k in this.poolStrings) {
    if (coinbaseBuffer.toString('utf-8').match(k)) {
      return this.poolStrings[k];
    }
  }

  return {};
};

//helper to convert timestamps to yyyy-mm-dd format
BlockController.prototype.formatTimestamp = function(date) {
	  var yyyy = date.getUTCFullYear().toString();
	  var mm = (date.getUTCMonth() + 1).toString(); // getMonth() is zero-based
	  var dd = date.getUTCDate().toString();

  return yyyy + '-' + (mm[1] ? mm : '0' + mm[0]) + '-' + (dd[1] ? dd : '0' + dd[0]); //padding
};

BlockController.prototype.getBlockReward = function(height) {
  var halvings = Math.floor(height / 210000);
  // Force block reward to zero when right shift is undefined.
  if (halvings >= 64) {
    return 0;
  }

  // Subsidy is cut in half every 210,000 blocks which will occur approximately every 4 years.
  var subsidy = new BN(50 * 1e8);
  subsidy = subsidy.shrn(halvings);

  return parseInt(subsidy.toString(10));
};

module.exports = BlockController;
