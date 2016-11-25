const grpc = require('grpc');

const PROTO_PATH = __dirname + '/pb/ripta.proto';
const SERVER_ADDR = process.env.SERVER_ADDR || 'localhost:9001'
const {pb} = grpc.load(PROTO_PATH);

module.exports = new pb.Ripta(SERVER_ADDR, grpc.credentials.createInsecure());
