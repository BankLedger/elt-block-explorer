var async = require('async');
var mongo = require("mongoskin");
var index = require('../');
var log = index.log;
var bitcore = require('bitcore-lib');
var _  = bitcore.deps._;
var config = bitcore.MongodbAndUnlockConfig;
var spawn  = require('child_process').spawn;

function MongoDBGetAddressTransaction(bitcoind, callback) {

	this.db = mongo.db(config.mongodbconfig.uri, config.mongodbconfig.options);
	this.db.bind("block");
	this.db.bind("address");
	this.db.bind("lockedTx");
	this.db.bind("txInput");
	this.db.bind("txOutput");
	this.bitcoind = bitcoind;
	this.callback = callback;
	this.first=true;
}

MongoDBGetAddressTransaction.prototype.synchroizedBlockAdressTxToMongoDB = function(myCallback) {
	var myself = this;

	async.series({
		dbHeight : function(callback) {
			myself.db.block.find({
				'id' : 1
			}).toArray(function(err, blockObj) {
				if (err) {
					log.error("dbHeight get height for mongodb err:"+err);
					return err;
				}
				if(blockObj && blockObj[0]){
					blockObj=blockObj[0];
				}else{
					blockObj={height:0};
				}
				var dbHeighRs = parseInt(blockObj.height) > 0 ? parseInt(blockObj.height)-1 : 0;
				callback(null, dbHeighRs);
			})
		},
		blockHeight : function(callback) {
			myself.bitcoind.getInfo(function(err, blockHeight) {
				if (err) {
					log.error("getinfo err:"+err);
					return err;
				}
				console.log("init found blockchain height is :"+blockHeight.blocks);
				callback(null, blockHeight.blocks);
			})
		}
	}, function(err, heightInfo) {
		if (err) {
			log.error("synchroizedBlockAdressTxToMongoDB async.series err :"+err);
			callback(err);
		}
		var startTimestamp= new Date().getTime();
		console.log("开始同步数据区块链数据到mongoDB");
		var totalHandleBlock = parseInt(heightInfo.blockHeight) - parseInt(heightInfo.dbHeight);
		var oneStar = parseInt(totalHandleBlock / 100);
		oneStar = oneStar === 0 ? 1 : oneStar;
		if(myself.first){
			console.log("即将同步区块数量："+ totalHandleBlock +" one star equals to  "+oneStar);
		}else{
			console.log("即将同步区块数量："+ totalHandleBlock);
		}

		var handleCount = 0;
		var percent = 0;
		async.whilst(function() {
			var rs = heightInfo.blockHeight > heightInfo.dbHeight;// if true	
			return rs;
		}, function(callback) {
			heightInfo.dbHeight++;
			myself.db.block.update({
				'id' : 1
			}, {
				$set : {
					'height' : heightInfo.dbHeight
				}
			}, {
				upsert : true
			}, function(err, result) {
				if (err){
					log.error("async.whilst error update DB "+ err);
					callback(err);
				}
				else if(myself.first){
					handleCount++;
					if(Math.floor(handleCount/oneStar)>percent){
						percent++;
						process.stdout.write('*');
						if(percent===100){
							process.stdout.write('\n');
						}
					}
				}
			})
			myself.processBlockByHeight(heightInfo, callback); // do one block  height
		}, function(err, newHeight) {
			if (err) {
				log.error("whilst err:"+err);
				callback(err);
			}
			myself.db.block.update({
				'id' : 1
			}, {
				$set : {
					'height' : heightInfo.blockHeight
				}
			}, {
				upsert : true
			}, function(err, result) {
				if (!err && newHeight) {
					heightInfo.blockHeight = newHeight;
				}
			})
			log.info('');
			console.log("total synchronized time(s):"+(new Date().getTime()-startTimestamp)/1000);
			if(myself.first){
				myself.first = false;
				myself.bitcoind.emit('ready');
				log.info('');
				log.info('Bitcoin Daemon Ready');
				myself.timer(myself,heightInfo);
			}else{
				myCallback(null,heightInfo);
			}
		});
	});
}

MongoDBGetAddressTransaction.prototype.timer = function(myself,heightInfo){
	setTimeout(function(){
		async.waterfall([
				myself.clearErrorData.bind(myself, heightInfo),
				myself.synchroizedBlockAdressTxToMongoDB.bind(myself),
//						myself.deleteExcessData.bind(myself)
			], function(err,info) {
				if (err) {
					log.error("processBlockByHeight: async.waterfall error happend:"+err);
				}
				myself.timer(myself,info);
		});
	},1000 * 60);
}

MongoDBGetAddressTransaction.prototype.processBlockByHeight = function(heightInfo, callback) {
	var myself = this;
	async.waterfall([
			myself.getTxListAndBlockMessageFromHight.bind(myself, heightInfo),
			myself.processTxList.bind(myself)
		], function(err) {
		if (err) {
			log.error("processBlockByHeight: async.waterfall error happend:"+err);
			callback(err);
		}else{
			if (heightInfo.height === heightInfo.blockHeight) {
				myself.bitcoind.getInfo(function(err, info) {
					if (err) {
						log.error("processBlockByHeight getInfo err"+err)
						callback(err);
					}else{
						callback(null, info.blocks);
					}
				})
			} else {
				callback(null);
			}
		}
	});
}

MongoDBGetAddressTransaction.prototype.getTxListAndBlockMessageFromHight = function(heightInfo,
		callback) {
	var self = this;
	self.bitcoind.getBlockByNumber(heightInfo.dbHeight, function(err,
			blockObject) {
		if (err) {
			log.error("getTxListAndBlockMessageFromHight err :"+err);
			callback(err);
		}else{
			var lockedTxData={};
			lockedTxData.currHeight=blockObject.result.height;
			lockedTxData.blockTime=blockObject.result.time;
			lockedTxData.blockHightWhenOperation=heightInfo.blockHeight;
			self.insertBlockToMongodb(blockObject);
			callback(null, blockObject.result.tx,lockedTxData);
		}
	})
}

MongoDBGetAddressTransaction.prototype.insertBlockToMongodb = function(block) {
	var self = this;
	
	self.db.block.find({"hash":block.result.hash}).toArray(function(err,blockObj){
		if(err){
			console.log("insertBlockToMongodb block findOne err: "+err);
		}
		if(blockObj.length === 0){
			self.db.block.find({"id":{$ne:1}}).toArray(function(err,blockList){
				if(err){
					log.error("insertBlockToMongodb block find err :"+err);
				}
				if(blockList.length >= 300){
					self.db.block.remove({'hash':blockList[0].hash,'time':blockList[0].time});
				}
			})
			self.db.block.insert(block.result);
		}
	})
}

MongoDBGetAddressTransaction.prototype.processTxList = function(txList,mylockedTxData,callback) {
	var lockedTxData=_.clone(mylockedTxData);
	var myself = this;
	var txIndex=0;
	var maxTxLength=txList.length;

	async.whilst(function() {
		var rs = maxTxLength > txIndex;// if true				
		return rs;
	},function(mycallback){
		myself.processTransaction(txList[txIndex++],lockedTxData, function(err, rs) {
			if (err) {
				log.error("processTxList processTransaction error happend :"+err);
				mycallback(err);
			}else{
				mycallback(null);
			}
		});
	},function(err,rs){
		if (err) {
			log.error("processTxList whilst error happend :"+err);
			callback(err);
		}
		else{
			callback(null);
		}
	});
}

MongoDBGetAddressTransaction.prototype.processTransaction = function(txid,lockedTxData,
		callback) {
	var myself = this;
	myself.bitcoind.getRawTransactionJson(txid,function(err, transaction) {
		if (err) {
			log.error("processTransaction txid:" + txid + " err:"+err);
			callback(err);
		}
		if (null == transaction) {
			log.error("processTransaction txid:" + txid + " result is empty:");
		}
		lockedTxData.txid=txid;
		lockedTxData.txTime=transaction.time;
		async.waterfall([
			myself.processEachInput.bind(myself, transaction),
			myself.processEachOutput.bind(myself, transaction,lockedTxData), ],
			function(err, result) {
				if (err) {
					log.error("processTransaction async.waterfall error happend:"+err);
					callback(err);
				} else {
					callback(null);
				}
			});
		})
}

MongoDBGetAddressTransaction.prototype.processEachInput = function(transaction,callback) {
	var myself = this;
	async.mapSeries(transaction.vin, function(input,mycurrCallback) {
		if (!myself.isInputValid(input)) {
			mycurrCallback(null);
		}else{
		myself.db.txInput.find({'txid':transaction.txid,'prevTxid':input.txid,'value':input.value,'address':input.address}).toArray(function(err,result){
			if(err){
				log.error("chackTxInputExistMongoDB txInput.find err "+err);
				log.error("chackTxInputExistMongoDB txInput.find txid "+txid+"prevTxid"+input.txid+"address"+input.address);
				mycurrCallback(err);
			}else if(result.length === 0){
				async.waterfall([
					myself.doAddSentedValue.bind(myself,input,transaction.txid),
					myself.addEixstInputForMongo.bind(input,transaction.txid,myself.db),
					],
					function(err, result) {
						if (err) {
							log.error("processEachInput async.waterfall error happend :" + err);
							callback(err);
						} else {
							mycurrCallback(null);
						}
					})
				}else{
					mycurrCallback(null);
				}
			
			})
		}
	},function (err,prs){
		if(err){
			log.error("processEachInput async.map callback function error happend "+err);
			callback(err);
		}else{
			callback(null);
		}
	});
}

MongoDBGetAddressTransaction.prototype.processEachOutput = function(transaction,lockedTxData, callback) {
	var myself = this;
	async.mapSeries(transaction.vout, function(output,myCallback) {
		if (!myself.isOutputValid(output)) {
			myCallback(null);
		}else{
			myself.db.txOutput.find({'txid':transaction.txid,'outputIndex':output.n,'value':output.value,'address':output.scriptPubKey.addresses[0]}).toArray(function(err,result){
				if(err){
					log.error("chacktxOutputExistMongoDB Output.find err :"+err);
					log.error("chacktxOutputExistMongoDB Output.find txid :"+transaction.txid+"outputIndex"+output.n+"address"+output.scriptPubKey.addresses[0]);
					myCallback(err);
				}else if(result.length === 0){
					async.waterfall([
						myself.doAddReceivedValue.bind(myself,output,transaction.txid,lockedTxData),
						myself.addEixstOutputForMongo.bind(output,transaction.txid,myself.db),
					],
						function(err, result) {
							if (err) {
								log.error("processEachOutput waterfall error happend!"+err);
								callback(err);
							} else{
								myCallback(null);
							}
						});
				}else{
					myCallback(null);
				}
			})
		}
	},function(err,rs){
		if(err){
			log.error("processEachOutput async.map callback function function(err,rs) error happend:"+err)
			callback(null);
		}else{
			callback(null);
		}
	});
}

MongoDBGetAddressTransaction.prototype.isInputValid = function(input) {
	if (null === input) {
		return false;
	} else if (input.address && input.txid && input.value) {
		return true;
	}
	return false;
}

MongoDBGetAddressTransaction.prototype.isOutputValid = function(output) {
	if (null === output) {
		return false;
	} else if (output.value && output.scriptPubKey
			&& output.scriptPubKey.addresses
			&& output.scriptPubKey.addresses[0]) {
		return true;
	}
	return false;
}

//add input sented value in mongodb
MongoDBGetAddressTransaction.prototype.doAddSentedValue = function(input,txid,callback) {
	var myself = this;
	myself.db.address.find({
		'address' : input.address
	}).toArray(function(err, addressObj) {
		if (err) {
			log.error("getDbAddressSentedValue db.address.find err :"+err);
			callback(err);
		}
		var totalUpdateValue = input.value;
		var txidList = [];
		var inputIndex = '';
		if(addressObj && addressObj[0]){
			if ( addressObj[0].Sented >= 0) {
				totalUpdateValue = addressObj[0].Sented + input.value;
			}
			if (addressObj[0].txs && !myself.isInArray(txid,addressObj[0].txs)) {
				addressObj[0].txs.unshift(txid);
			}
			txidList = addressObj[0].txs;
			inputIndex = addressObj[0].inputIndex;
		}else{
			totalUpdateValue = input.value;
			txidList.unshift(txid);
		}
		if( inputIndex !== input.vout+"_"+input.txid){
			myself.db.address.update({
				'address' : input.address
			}, {
				$set : {
					'Sented' : totalUpdateValue,
					'txs':txidList,
					'inputIndex':input.vout+"_"+input.txid
				}
			}, {
				upsert : true
			}, function(err, result) {
				if (err){
					log.error("setDbAddressSentValue db.address.update err :"+err);
					callback(err);
				}else{
					callback(null);
				}
			})
		}else{
			callback(null);
		}
	})
}

MongoDBGetAddressTransaction.prototype.addEixstInputForMongo = function(txid,db,callback) {
	var input = this;
	db.txInput.insert({'txid':txid,'prevTxid':input.txid,'value':input.value,'address':input.address},function(err,result){
		if(err){
			callback(err);
		}else{
			callback(null);
		}
	});
}

function isLocked(lockedTxData) {
	if(lockedTxData && lockedTxData.unlockHeight && lockedTxData.unlockHeight>0){
		if(lockedTxData.unlockHeight > lockedTxData.currHeight ){
			return true;
		}
	}
	return false;
}

//add output received value in mongodb
MongoDBGetAddressTransaction.prototype.doAddReceivedValue = function(output,txid,lockedTxData,
		callback) {
	var myself = this;
	var mylockedTxData=_.clone(lockedTxData);
	mylockedTxData.outputIndex=output.n;
	mylockedTxData.value=output.value;
	mylockedTxData.unlockHeight=output.unlockHeight;
	myself.db.address.find({
		'address' : output.scriptPubKey.addresses[0]
	}).toArray(function(err, addressObj) {
		if (err) {
			log.error("getDbAddressReceivedValue db.address.find err :"+err);
			callback(err);
		}
		var totalUpdateValue = output.value;
		var outputIndex = '';
		var txidList = [];
		var dbLockedValue=0;
		//判断锁定交易
		if(isLocked(mylockedTxData)){
			if (addressObj && addressObj[0] && addressObj[0].lockedValue) {
				dbLockedValue = addressObj[0].lockedValue + output.value;
			}else{
				dbLockedValue = output.value;
			}
			mylockedTxData.addMany=0.05*( (( parseFloat(mylockedTxData.unlockHeight)- parseFloat(lockedTxData.currHeight))*60)/(60*60*24*30*12) )* parseFloat(mylockedTxData.value);
			mylockedTxData.address = output.scriptPubKey.addresses[0];
			myself.db.lockedTx.insert(mylockedTxData);
		}else{
			if (addressObj && addressObj[0] && addressObj[0].lockedValue) {
				dbLockedValue = addressObj[0].lockedValue;
			}
		}
		if(addressObj && addressObj[0]){
			if(addressObj[0].Received >= 0){
				totalUpdateValue = addressObj[0].Received + output.value;
			}
			if(addressObj[0].txs && !myself.isInArray(txid,addressObj[0].txs)){
				addressObj[0].txs.unshift(txid);
			}
			txidList = addressObj[0].txs;
			outputIndex = addressObj[0].outputIndex;
		}else{
			totalUpdateValue = output.value;
			txidList.unshift(txid);
		}

		if( outputIndex !==  output.n+"_"+txid ){
			myself.db.address.update({
				'address' : output.scriptPubKey.addresses[0]
			}, {
				$set : {
					'Received' : totalUpdateValue,
					'lockedValue': dbLockedValue,
					'txs'		: txidList,
					'outputIndex':output.n+"_"+txid
				}
			}, {
				upsert : true
			}, function(err, result) {
				if (err){
					log.error("setDbAddressReceivedValue db.address.update err :"+err);
					callback(err);
				}else{
					callback(null);
				}
			})
		}else{
			callback(null);
		}
	})
}

MongoDBGetAddressTransaction.prototype.addEixstOutputForMongo = function(txid,db,callback) {
	var output = this;
	db.txOutput.insert({'txid':txid,'value':output.value,'address':output.scriptPubKey.addresses[0],'outputIndex':output.n},function(err,result){
		if(err){
			log.error("addEixstOutputForMongo  txOutput insert err:"+err);
			callback(err);
		}else{
			callback(null);
		}
	});
}

//check txid existence for mongidb address
MongoDBGetAddressTransaction.prototype.isInArray=function(txid,arr){
	return arr.indexOf(txid) >= 0 ? true:false;
}

MongoDBGetAddressTransaction.prototype.clearErrorData = function(heightInfo,myCallback){
	var self = this;
	var index = 0;
	self.db.block.find({'id':{$ne:1}}).toArray(function(err,blockList){
		if(err){
			log.error("clearErrorData block.find err: "+err);
			myCallback(err);
		}else{
			async.whilst(function(){
				return index < blockList.length;
			},function(callback){
				var block = blockList[index++];
				self.bitcoind.getBlockByNumber(block.height,function(err,blockObj){
					if(err){
						log.error("clearErrorData bitcored.getBlock err: "+err);
						callback(err);
					}else{
						if(block.hash !== blockObj.result.hash){
							heightInfo.dbHeight = block.height;
							async.waterfall([
								self.eachTxidForBlock.bind(self,block.tx),
								self.modifyCorrectDate.bind(self,heightInfo),
							], function(err) {
								if (err) {
									log.error("clearErrorData: async.waterfall error: "+err);
									callback(err);
								}else{
									console.log("height: "+block.height);
									self.db.block.remove({"hash":block.hash});
									callback(null);
								}
							});
						}else{
							callback(null);
						}
					}
				})
			},function(err){
				if(err){
					log.error("clearErrorData async.whilst err: "+err);
					myCallback(err);
				}else{
					myCallback(null);
				}
			})
		}
	})
}

MongoDBGetAddressTransaction.prototype.modifyCorrectDate =function(heightInfo,callback){
	var self = this;
	self.processBlockByHeight(heightInfo,function(err){
		if(err){
			log.error("modifyCorrectDate processBlockByHeight err: " + err);
			callback(err);
		}else{
			callback(null);
		}
	});
}

MongoDBGetAddressTransaction.prototype.eachTxidForBlock = function(txList,Mycallback){
	var self = this;
	var index = 0;
	async.whilst(function(){
		return index < txList.length;
	},function(callback){
		var tx = txList[index++];
		async.waterfall([
			self.clearErrorDataForInput.bind(self,tx),
			self.clearErrorDataForOutput.bind(self,tx),
		], function(err) {
			if (err) {
				log.error("clearErrorData: async.waterfall error: "+err);
				callback(err);
			}
			else{
				callback(null);
			}
		});
	},function(err){
		if(err){
			log.error("clearErrorData async.whilst err: "+err);
			Mycallback(err);
		}else{
			Mycallback(null);
		}
	})

}

MongoDBGetAddressTransaction.prototype.clearErrorDataForInput = function(txid,myCallback){
	var self = this;
	var mydb = self.db;
	var index = 0;
	mydb.txInput.find({'txid':txid}).toArray(function(err,inputList){
		if(err){
			log.error("clearErrorDataForInput txInput.find: "+err);
			callback(err);
		}else{
			async.mapSeries(inputList, function(input,callback) {
				mydb.address.find({"address":input.address}).toArray(function(err,addressObj){
					if(err){
						log.error("clearErrorDataForInput async whilst err :"+err+" address "+input.address);
						callback(err);
					}else{
						var sented = parseFloat(addressObj[0].Sented.toFixed(8)) - parseFloat(input.value.toFixed(8));
						var txs = deleteTxidForArray(addressObj[0].txs,txid);
						console.log("--------------------------------clearErrorDataForInput-----------------------------------");
						console.log("address:	"+input.address);
						console.log("value:		"+input.value);
						console.log("Sented:	"+addressObj[0].Sented);
						console.log("sented:    "+sented);
						mydb.txInput.remove(input,function(err,result){
							if(err){
								consolelog("clearErrorDataForInput mydb.txInput.remove err: "+err);
								callback(err);
							}else{
								mydb.address.update({"address":addressObj[0].address},{$set:{"Sented":sented,"txs":txs,"inputIndex":"_"}},function(err,result){
									if(err){
										consolelog("clearErrorDataForInput mydb.address.update err: "+err);
										callback(err);
									}else{
										callback(null);
									}
								});
							}
						});
						
					}
				})
			},function(err){
				if(err){
					log.error("clearErrorDataForInput async.whilst err: "+err);
					myCallback(err);
				}else{
					myCallback(err);
				}
			})
		}
	})
}

MongoDBGetAddressTransaction.prototype.clearErrorDataForOutput = function(txid,myCallback){
	var self = this;
	var mydb = self.db;
//	var index = 0;
	mydb.txOutput.find({"txid":txid}).toArray(function(err,outputList){
		async.mapSeries(outputList, function(output,callback) {
			mydb.address.find({"address":output.address}).toArray(function(err,addressObj){
				if(err){
					log.error("clearErrorDataForOutput address find err :"+err);
					myCallback(err);
				}else{
					var received = parseFloat(addressObj[0].Received.toFixed(8)) - parseFloat(output.value.toFixed(8));
					var txs = deleteTxidForArray(addressObj[0].txs,txid);
					var lockedValue = addressObj[0].lockedValue;
					mydb.lockedTx.find({"txid":txid,"address":addressObj[0].address}).toArray(function(err,lockedTxObj){
						if(err){
							log.error("clearErrorDataForOutput lockedTx find err :" + err);
							myCallback(err);
						}else{
							if(lockedTxObj.length > 0){
								for(var i =0;i < lockedTxObj.length;i++){
									lockedValue -= lockedTxObj[i].value;
									lockedValue -= lockedTxObj[i].addMany;
									mydb.lockedTx.remove(lockedTxObj[i]);
								}
							}
							console.log("--------------------------------clearErrorDataForOutput----------------------------------");
							console.log("address:     "+output.address);
							console.log("value:       "+output.value);
							console.log("Received:	  "+addressObj[0].Received);
							console.log("lockedValue: "+addressObj[0].lockedValue);
							console.log("received:    "+received);
							console.log("lockedValue: "+lockedValue);
							mydb.txOutput.remove(output,function(err,result){
								if(err){
									console.log("clearErrorDataForOutput mydb.txOutput.remove err: "+err);
									callback(err);
								}else{
									mydb.address.update({"address":addressObj[0].address},{$set:{"Received":received,"txs":txs,"lockedValue":lockedValue,"outputIndex":"_"}},function(err,result){
										if(err){
											console.log("clearErrorDataForOutput mydb.address.update err: "+err);
											callback(err);
										}else{
											callback(null);
										}
									});
								}
							});
						}
					})
				}
			})
		},function(err){
			if(err){
				log.error("clearErrorDataForOutput async.mapSeries err: "+err);
				myCallback(err);
			}else{
				myCallback(null);
			}
		})
	})
}

var deleteTxidForArray = function(array,txid){
	var spliceIndex = array.indexOf(txid);
	if(spliceIndex >= 0){
		array.splice(spliceIndex,1);
	}
	return array;
}

//MongoDBGetAddressTransaction.prototype.deleteExcessData =function(){
//	
//	async.waterfall([
//		self.deleteExcessDataToInput.bind(self),
//		self.deleteExcessDataToOutput.bind(self),
//	], function(err) {
//		if (err) {
//			log.error("clearErrorData: async.waterfall error: "+err);
//		}
//	});
//}

//MongoDBGetAddressTransaction.prototype.deleteExcessDataToInput = function(callback){
//	var self = this;
//	var maxRetainInput = 200 * 500 * 5;
//	self.db.txInput.find().toArray(function(err,inputList){
//		if(err){
//			log.error("deleteExcessDataToInput txOutput.find err: "+err);
//			callback(err);
//		}else{
//			if(inputList.length > maxRetainInput){
//				for(var i = 0;i < inputList.length - maxRetainInput; i++){
//					self.db.txInput.remove({"txid":inputList[i].txid,"prevTxid":inputList[i].prevTxid,"address":inputList[i].address})
//				}
//			}
//			callback(null);
//		}
//	})
//}
//
//MongoDBGetAddressTransaction.prototype.deleteExcessDataToOutput = function(callback){
//	var self = this;
//	var maxRetainOutput = 200 * 500 * 5;
//	self.db.txOutput.find().toArray(function(err,outputList){
//		if(err){
//			log.error("deleteExcessDataToInput txOutput.find err: "+err);
//			callback(err);
//		}else{
//			if(outputList.length > maxRetainOutput){
//				for(var i = 0;i < outputList.length - maxRetainOutput; i++){
//					self.db.txOutput.remove({"txid":outputList[i].txid,"prevTxid":outputList[i].prevTxid,"address":outputList[i].address})
//				}
//			}
//			callback(null);
//		}
//	})
//}

module.exports = MongoDBGetAddressTransaction;
