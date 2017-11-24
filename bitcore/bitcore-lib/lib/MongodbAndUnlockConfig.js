module.exports = {
		mongodbconfig:{
			uri : "mongodb://localhost:27017/elt",
			options : {
				server : {
					socketOptions : {
						socketTimeoutMS : 0,
						connectionTimeout : 0
					}
				}
			}
		},
		Unlock:{
			height: 1,
			time  : 1500000000
		}
}


//module.exports = MongodbAndUnlockConfig;
