﻿const argv = require('yargs').argv;
const config = require('config');
const bigInt = require("big-integer");
const crypto = require('crypto');
const fs = require('fs');
const sjcl = require("./sjcl.js");
const ecoprf = require("./ecoprf.js");

const log = (msg) => { if (l) { console.log(msg ? msg : "") } };

config.server.biD = bigInt(config.server.d);
config.server.biN = bigInt(config.server.n);
config.server.k1 = sjcl.bn.fromBits(sjcl.hash.sha256.hash(config.server.eckey + "1"));
config.server.k2 = sjcl.bn.fromBits(sjcl.hash.sha256.hash(config.server.eckey + "2"));

var strxor = (str, mask) => {
    let strbuf = new Uint8Array(Buffer.from(str, 'utf8'));
    let maskbuf = new Uint8Array(Buffer.from(mask, 'utf8'));

    for (let i = 0; i < strbuf.length; i++) {

        strbuf[i] = strbuf[i] ^ maskbuf[i % maskbuf.length];

    }

    let buf = Buffer.from(strbuf);

    return buf.toString('utf8');
};

var path = '../testData/phishtank.json';
if (argv.p) {
    path = argv.p;
}

var maxnum = 10;
if (argv.m) {
    maxnum = argv.m;
}

var source = 'PhishTank';
if (argv.s) {
    source = argv.s;
}

var out = 'out.json';
if (argv.o) {
    out = argv.o;
}

var l = false;
if (argv.l) {
    l = true;
}

var oprf = "rsa";
if (argv.f) {
    oprf = argv.f;
}

//diff the time
g_diffTime = -1;
var diffTime = () => {
    if (g_diffTime > 0) {
        return Date.now() - g_diffTime;
    }
    else {
        g_diffTime = Date.now();
    }
}

console.log(`BuildSecBlackList with Path = ${path}, MaxNum = ${maxnum}, DefaultSource = ${source}, OPRF = ${oprf}`);

log(`Begin to read json source, please wait...`);

let json = require(path);

log('Finish reading the json source');

maxnum = (maxnum == -1) ? json.length : maxnum;

log(`Will build an index with ${maxnum} records`);

if (oprf == "rsa") {
    log(`The config.server => d = ${config.server.biD}, e = ${config.server.biN}`);
} else if (oprf == "ec") {
    log(`The config.server => eckey = ${config.server.eckey}, k1 = ${config.server.k1}, ke2 = ${config.server.k2}`);
}
else {
    log(`ERROR CONFIG on [oprf]`);
    process.exit(-1);
}


let blacklistSet = [];
let blacklistIndex = [];

//oprf = rsa
let rsa_oprf_build = (item) => {

    //process hash1
    hash = crypto.createHash('sha256');
    hash.update(item.u + "*1", 'utf8');
    let hash1 = hash.digest('hex');
    let biHash1 = new bigInt(hash1, 16);
    //compute sign
    let biSign1 = biHash1.modPow(config.server.biD, config.server.biN);
    hash = crypto.createHash('sha256');
    hash.update(biSign1.toString(), 'utf8');
    let t1 = hash.digest('hex');

    //process hash2
    hash = crypto.createHash('sha256');
    hash.update(item.u + "*2", 'utf8');
    let hash2 = hash.digest('hex');
    let biHash2 = new bigInt(hash2, 16);
    //compute sign
    let biSign2 = biHash2.modPow(config.server.biD, config.server.biN);
    hash = crypto.createHash('sha256');
    hash.update(biSign2.toString(), 'utf8');
    let t2 = hash.digest('hex');

    return {
        t1: t1,
        t2: t2
    };

};

//oprf = ec
let ec_oprf_build = (item) => {

    let p256 = sjcl.ecc.curves.c256;
    const h = new sjcl.hash.sha256();

    //process seed
    let seed1 = item.u + "*1";
    let seed2 = item.u + "*2";

    //map to curve
    let p1 = ecoprf.hashToCurve(seed1);
    let p2 = ecoprf.hashToCurve(seed2);

    //compute sign
    let s1 = ecoprf.signPoint(config.server.k1, p1);
    let s2 = ecoprf.signPoint(config.server.k2, p2);

    //convert point to hex
    let t1 = sjcl.codec.hex.fromBits(ecoprf.compressPoint(s1));
    let t2 = sjcl.codec.hex.fromBits(ecoprf.compressPoint(s2));

    return {
        t1: t1,
        t2: t2
    };

}

//first Uint test
let buildFirstUintTest = (item) => {

    //process first 32bit hash
    let hash = crypto.createHash('sha256');
    hash.update(item.u, 'utf8');
    let hashBuf = hash.digest();
    let firArrUint = new Uint32Array(hashBuf.buffer, 0, 4);
    //get first 32bit
    return firArrUint[0];

};


diffTime();

for (let i = 0; i < maxnum; i++) {

    let item = json[i];

    //first 32bit
    let firUint = buildFirstUintTest(item);

    //OPRF Token generate
    let res;
    if (oprf == "rsa") {

        res = rsa_oprf_build(item);

    } else if (oprf == "ec") {

        res = ec_oprf_build(item);

    } else {
        console.log(`Error params : UNKNOWN oprf type [${oprf}]`);
        process.exit(-1);
    }

    log("========================================================");
    log(item.u);
    log(`firUint = ${firUint}`);
    log(`T1 = ${res.t1}`);
    log(`T2 = ${res.t2}`);

    log("========================================================");

    //packet trapdoors
    let val = {
        t: item.m
    };

    let strval = JSON.stringify(val);
    let encVal = strxor(strval, res.t2);

    blacklistIndex.push([
        res.t1,
        encVal
    ]);

    //packet blacklist set
    blacklistSet.push(firUint);

}

let dtime = diffTime();

console.log(`Finish building index within ${dtime} ms.`);

let blacklist = {
    s: blacklistSet,
    m: blacklistIndex
};


/*
[
    {
        m:0|1|2,
        u:"url"
    },
    ...
]
*/

log("Finish build security black list.");

fs.writeFile(out, JSON.stringify(blacklist), function (err) {
    if (err) {
        return console.log(err);
    }

    console.log("Finish write into the file. ");
}); 
