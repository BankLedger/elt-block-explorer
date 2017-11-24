var block={ hash: '000001faef25dec4fbcf906e6242621df2c183bf232f263d0ba5b101911e4563',
		  confirmations: 295002,
		  size: 186,
		  height: 0,
		  version: 1,
		  merkleroot: '12630d16a97f24b287c8c2594dda5fb98c9e6c70fc61d44191931ea2aa08dc90',
		  mint: 0,
		  time: 1393221600,
		  nonce: 164482,
		  bits: '1e0fffff',
		  difficulty: 0.00024414,
		  blocktrust: '100001',
		  chaintrust: '100001',
		  nextblockhash: '00000c0dfe0ea4bdf83516e2170bf950f8184392766ac70a26d4aa4a394c1570',
		  flags: 'proof-of-work stake-modifier',
		  proofhash: '000001faef25dec4fbcf906e6242621df2c183bf232f263d0ba5b101911e4563',
		  entropybit: 1,
		  modifier: '0000000000000000',
		  modifierv2: '0000000000000000000000000000000000000000000000000000000000000000',
		  tx: [ '12630d16a97f24b287c8c2594dda5fb98c9e6c70fc61d44191931ea2aa08dc90' ] };


var buffer = new Buffer(JSON.stringify(block), 'hex');

console.log(buffer);