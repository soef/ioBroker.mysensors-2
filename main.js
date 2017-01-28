"use strict";


var util        = require('util');
var utils       = require(__dirname + '/lib/utils');
var _MySensors  = require(__dirname + '/lib/mysensors');
var sensorEnums = require(__dirname + '/lib/mySensors-enums');
var meta        = require(__dirname + '/lib/getmeta').meta;
var sprintf     = require("sprintf-js").sprintf;

var STATE_INCLUSION_ON    = 'commands.inclusionOn',
    STATE_INFO_CONNECTION = 'info.connection'
    ;

var devices   = {};
var mySensorsInterfaces = {};
var mySensorsInterfacesLength = 0;
var inclusionOn = true;
var inclusionTimeoutTimer = null;
var gatewayReady = false;
var config = {};
var serialport;
var g_commands;

try {
    serialport = require('serialport');
} catch (e) {
    console.warn('Serial port is not available');
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

var adapter = utils.adapter({
    name: 'mysensors-2',

    unload: onUnload,
    objectChange: function (id, obj) {
        if (!obj) {
            if (devices[id]) delete devices[id];
        } else {
            if (obj.native.id !== undefined && obj.native.childId !== undefined && obj.native.subType !== undefined) {
                devices[id] = obj;
            }
        }
    },

    stateChange: function (id, state) {
        if (!state || state.ack || !mySensorsInterfacesLength)
            return;
        onStateChange(id, state);
    },

    ready: function () {
        main();
    },

    message: function(obj) {
        if (!obj) return;
        switch (obj.command) {
            case 'listUart':
                if (obj.callback) {
                    if (serialport) {
                        serialport.list(function (err, ports) {
                            adapter.log.debug('List of ports: ' + JSON.stringify(ports));
                            adapter.sendTo(obj.from, obj.command, ports, obj.callback);
                        });
                    } else {
                        adapter.log.warn('Module serialport is not available');
                        adapter.sendTo(obj.from, obj.command, [{comName: 'Not available'}], obj.callback);
                    }
                }
                break;
        }
    }
});

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////


function onUnload(callback) {
    if (adapter && typeof adapter.setState === 'function') adapter.setState(STATE_INFO_CONNECTION, false, true);
    try {
        for (var i in mySensorsInterfaces) {
            mySensorsInterfaces[i].destroy();
            delete mySensorsInterfaces[i];
        }
        callback();
    } catch (e) {
        callback();
    }
}

function onStateChange(id, state) {
    var ar = id.split('.');
    var mySI = mySensorsInterfaces[ar[2] === 'Serial' ? 'serial' : adapter.config.type];
    if (!mySI) return;
    
    var commandIdx = id.indexOf('.commands.');
    if (commandIdx > 0) {
        var cmd = id.substr(commandIdx+10);
        if(cmd=='sendRaw') cmd = 'rawCommand';
        if (mySI.commands[cmd] != undefined) {
            if (commandIdx == adapter.namespace.length) {
                mySI.commands[cmd] (state.val);
            } else {
                mySI.commands[cmd] (id);
            }
            if (cmd.indexOf('request') == 0 && devices[id] && devices[id].common && devices[id].common.def != undefined && state.val != devices[id].common.def) {
                adapter.setState(id, devices[id].common.def, true);
            }
            return;
        }
    }

    if (devices[id] && devices[id].type == 'state') {
        if (typeof state.val === 'boolean') state.val = state.val ? 1 : 0;
        if (state.val === 'true')  state.val = 1;
        if (state.val === 'false') state.val = 0;

        mySI.write(
            devices[id].native.id           + ';' +
            devices[id].native.childId      + ';' + C_SET + ';' + ACK_FALSE + ';' +
            devices[id].native.varTypeNum   + ';' +
            state.val, devices[id].native.ip);
    }
}


function setInclusionState(val) {
    val = val === 'true' || val === true || val === 1 || val === '1';
    inclusionOn = val;

    if (inclusionTimeoutTimer) clearTimeout(inclusionTimeoutTimer);
    inclusionTimeoutTimer = null;

    if (inclusionOn && parseInt(adapter.config.inclusionTimeout)) {
        inclusionTimeoutTimer = setTimeout(function () {
            if (!gatewayReady) {
                setTimeout(function() {
                    setInclusionState(true);
                }, 2000);
                return;
            }
            inclusionOn = false;
            adapter.setState(STATE_INCLUSION_ON, false, true);
        }, parseInt(adapter.config.inclusionTimeout));
    }
}

function checkInclusion(result, msg) {
    if (!inclusionOn) {
        adapter.log.warn(msg ? msg : 'ID not found. Inclusion mode OFF: ' + JSON.stringify(result));
    }
    return inclusionOn;
}


function fullIdFromPacket(ip, packet) {
    return adapter.namespace + '.' + meta.deviceIdFromPacket(ip, packet);
}


function findDevice(result, ip) {
    // test
    var _id = fullIdFromPacket(ip, result);
    var rt = devices[_id];
    return (rt ? _id : undefined);
    //
    for (var id in devices) {
        if (devices[id].native &&
            (!ip || ip == devices[id].native.ip) &&
            devices[id].native.id == result.id &&
            devices[id].native.childId == result.childId &&
            devices[id].native.varType == result.subType) {
            if (_id != id) {
                id = id;
            }
            return id;
        }
    }
    if (rt != undefined) {
        rt = rt;
    }
    return undefined;
}


function createStateFromPacket(ip, res, cb, id) {
    if (!id) {
        id = fullIdFromPacket(ip, res);
    }
    //var v = meta._getVarEntry(res.varType);
    var v = meta._getVarEntry(res.varType || res.subType);
    var obj = {
        _id: id,
        type: 'state',
        common: {
            name: '',
            role: 'state',
            type: v.type
        },
        native: {
            ip: ip,
            id: res.id,
            childId: res.childId,
            subType: res.subType,
            varType: res.subType, //why varType and not subType?
            type: res.type,
            subTypeNum: res.num.subType,
            typeNum: res.num.type
        }
    };
    var parentId = id.substr(0, id.lastIndexOf('.'));
    obj.common.name = (devices[parentId] && devices[parentId].common.name) ? devices[parentId].common.name + '.' + res.subType : res.subType;
    //obj.common.name = (devices[parentId] && devices[parentId].common.name) ? devices[parentId].common.name /*+ '.' + res.subType*/ : res.subType;
    devices[id] = obj;
    adapter.log.info('Add new object: ' + id);
    adapter.setObject(id, obj, function (err) {
        if (err) adapter.log.error(err);
        if (cb) cb(id); else adapter.setState(id, v.def != undefined ? v.def : '', true);
    });
}


function saveResult(_id, result, ip, force) {
    if (_id == undefined) _id = findDevice(result, ip);

    function doIt(id) {
        if (devices[id].common.type == 'boolean') {
            result.payload = result.payload === 'true' || result.payload === true || result.payload === '1' || result.payload === 1;
        }
        if (devices[id].common.type == 'number')  result.payload = parseFloat(result.payload);

        adapter.log.debug('Set value ' + (devices[id].common.name || id) + ' ' + result.childId + ': ' + result.payload + ' ' + typeof result.payload);
        adapter.setState(id, result.payload, true);
        adapter.getObject(id, function(err, obj) {
            if (!err && obj) {
                var now = new Date();
                obj['lastChange'] = adapter.formatDate(new Date(), "YYYY-MM-DD - hh:mm:ss");
                adapter.setObject(id, obj);
            }
        })
    }

    if (_id != undefined && devices[_id]) {
        doIt(_id);
        return;
    }
    if (checkInclusion(result)) {
        if (force) createStateFromPacket(ip, result, doIt);
    }
}


function createDefaultCommands(id, sensorId, ip) {
    var i = 0;
    var cmds = [];
    for (var cmd in g_commands) {
        if (cmd.indexOf('request') == 0)
            cmds.push(cmd);
    }
    function doIt() {
        if (i < cmds.length) {
            var _id = id + '.commands.' + cmds[i];
            if (devices[_id]) {
                i++;
                setTimeout(doIt, 20);
                return;
            }
            var obj = {
                "_id": _id,
                "type": "state",
                "common": {
                    "role": "state",
                    "name": cmds[i],
                    "desc": cmds[i],
                    "type": "boolean",
                    "read": true,
                    "write": true,
                    "def": false
                },
                "native": {
                    id: sensorId,
                    ip: ip
                }
            };
            devices[_id] = obj;
            adapter.setObject(_id, obj, function (err, o) {
                adapter.setState(_id, false, true);
                i++;
                setTimeout(doIt, 20);
            });
        }
    }
    doIt();
}

// ToDo
// var pendingCommands = { // for battery powered or sleeping devices
//     cnt: 0,
//     arr: [],
//
//     add: function(cmd) {
//         this.arr.push(cmd);
//         this.cnt++;
//     },
//
//     check: function(id, ip) {
//         if (this.cnt <= 0) return;
//         if (id != 2) return;
//
//         while (this.arr.length) {
//             var cmd = this.arr.shift();
//             adapter.log.info('Sending pending command: ' + cmd);
//             mySensorsInterface.write(cmd);
//             this.cnt--
//         }
//
//         return;
//
//         if (!id || !devices[id].native.id) return;
//         var _id = fullIdFromPacket(ip, {id: devices[id].native.id});
//         var pendingCmds = devices[id].pending;
//         while (pendingCmds.length) {
//             var cmd = pendingCmds.slice();
//             mySensorsInterface.write(cmd);
//             this.cnt--
//         }
//     }
// };

//pendingCommands.add('2;0;3;0;19;0');


function createNode(res, ip, port) {
    var objs = meta.getMetaInfo(res, ip, port, config[ip || 'serial']);

    function doIt() {
        if (objs.length > 0) {
            var obj = objs.shift();
            var fullId = adapter.namespace + '.' + obj._id
            //adapter.log.debug('Check ' + devices[fullId]);
            if (!devices[fullId]) {
                devices[fullId] = obj;
                adapter.log.info('Add new object: ' + obj._id + ' - ' + obj.common.name);
                adapter.setObject(obj._id, obj, function (err) {
                    if (err) {
                        adapter.log.error(err);
                    } else {
                        if (obj.common && obj.common.def != undefined) {
                            adapter.setState(fullId, obj.common.def, true);
                        }
                    }
                    setTimeout(doIt, 20);
                });
            }
        }
    }
    doIt();
}

function logRawData(data) {
    var lines = data.split('\n');
    for (var i=0; i<lines.length; i++) {
        adapter.log.debug('onData: ' + lines[i]);
    }
}


function checkInstanceObjects(force, cb) {
    var i = 0;
    function doIt() {
        if (i < adapter.ioPack.instanceObjects.length) {
            var obj = adapter.ioPack.instanceObjects[i++];
            var id = adapter.namespace + '.' + obj._id;
            adapter.getObject(id, function(err, o) {
               if (force || err || !o) {
                   adapter.setObject(id, obj, function(err, o) {
                       if(!err && obj && obj.common && obj.common.def != undefined) {
                           adapter.setState(id, obj.common.def, true);
                       }
                       setTimeout(doIt, 20);
                   });
               } else setTimeout(doIt, 20);
            });
        } else {
            if (cb) cb();
        }
    }
    doIt();
}


function readExistingObjects (cb) {

    adapter.getForeignObjects(adapter.namespace + '.*', 'state', function (err, states) {
        devices = states;

        adapter.getForeignObjects(adapter.namespace + '.*', 'channel', function (err, states) {
            for (var o in states) {
                devices [o] = states[o];
            }
            // var type = soef.getProp(devices, adapter.namespace + '.' + STATE_INFO_CONNECTION + '.common.type');
            // if (!type || (type === 'boolean' && adapter.config.type !== 'serial') || (type !== 'boolean' && adapter.config.type === 'serial')) {
            if (!devices[adapter.namespace + '.'+STATE_INFO_CONNECTION] || !devices[adapter.namespace + '.'+STATE_INFO_CONNECTION].common ||
                (devices[adapter.namespace + '.'+STATE_INFO_CONNECTION].common.type === 'boolean' && adapter.config.type !== 'serial') ||
                (devices[adapter.namespace + '.'+STATE_INFO_CONNECTION].common.type !== 'boolean' && adapter.config.type === 'serial')) {
                adapter.setForeignObject(adapter.namespace + '.info.connection', {
                    _id: STATE_INFO_CONNECTION,
                    type: 'state',
                    common: {
                        role: 'indicator.connected',
                        name: adapter.config.type === 'serial' ? 'If connected to my sensors' : 'List of connected gateways',
                        type: adapter.config.type === 'serial' ? 'boolean' : 'string',
                        read: true,
                        write: false,
                        def: false
                    },
                    native: {}
                }, function (err) {
                    if (err) adapter.log.error(err);
                });
            }
            if(cb) cb();
        })
    })
}


// class MySensors extends _MySensors {
//     constructor(_adapter, _type, callback) {
//         super(_adapter, _type, callback);
//     }
//
// }


/**/
// var MySensors = function (_adapter, _type, callback) {
//     _MySensors.call(this, _adapter, _type, callback);
var MySensors = function (_adapter, _type) {
    _MySensors.call(this, _adapter, _type);

    var self = this;
    this.connectTries = 0;
    this.commands = {
        requestPresentation: function (id, ip) {
            //'255;0;3;0;19;0'
            self.mysSend(id, 0, C_INTERNAL, ACK_NO, I_PRESENTATION, '0', ip);
        },
        requestReboot: function (id, ip) {
            //'255;0;3;0;13;0'
            self.mysSend(id, 0, C_INTERNAL, ACK_NO, I_REBOOT, '0', ip);
        },
        requestHeartbeat: function (id, ip) {
            //'255;0;3;0;18;'
            self.mysSend(id, 0, C_INTERNAL, ACK_NO, I_HEARTBEAT, '0', ip);
        },
        requestClearEEPromAndReeboot: function(id,ip) {
            self.mysSend(id, 0, C_INTERNAL, ACK_NO, I_DEBUG, 'E', ip);
        },
        rawCommand: function(cmd, ip) {
            self.write(cmd, ip);
        },
        inclusionOn: function(bo) {
            setInclusionState(bo);
        }
    };
    g_commands = this.commands;
    
    this.pendingCommands = { // for battery powered or sleeping devices
        cnt: 0,
        arr: [],
        
        add: function(cmd) {
            this.arr.push(cmd);
            this.cnt++;
        },
        
        check: function(id, ip) {
            if (this.cnt <= 0) return;
            if (id != 2) return;
            
            while (this.arr.length) {
                var cmd = this.arr.shift();
                adapter.log.info('Sending pending command: ' + cmd);
                self.write(cmd);
                this.cnt--
            }
            
            return;
            
            if (!id || !devices[id].native.id) return;
            var _id = fullIdFromPacket(ip, {id: devices[id].native.id});
            var pendingCmds = devices[id].pending;
            while (pendingCmds.length) {
                var cmd = pendingCmds.slice();
                self.write(cmd);
                this.cnt--
            }
        }
    };
};
util.inherits(MySensors, _MySensors);
// Object.assign(MySensors, _MySensors);

// MySensors.super_ = _MySensors.prototype;
// MySensors.prototype = Object.create(_MySensors.prototype)
// MySensors.prototype.construcor = _MySensors;

MySensors.prototype.mysSend = function (destination, sensor, command, acknowledge, type, payload, ip) {
    if (typeof destination === 'string' && destination.indexOf ('.') >= 0) {
        if (destination.indexOf(adapter.namespace) != 0) {
            destination = adapter.namespace + '.' + destination;
        }
        var dev = devices[destination];
        if (!dev) return;
        destination = dev.native.id;
        if (!ip) ip = dev.native.ip;
    }
    if (destination == undefined) return;
    this.write(
        (typeof destination == 'string' ? destination : destination.toString()) + ';' +
        sensor.toString() + ';' +
        command.toString() + ';' +
        acknowledge.toString() + ';' +
        type.toString() + ';' +
        payload,
        ip);
};

MySensors.prototype.onData = function (data, client) {
    //logRawData(data);
    var result = sensorEnums.parse(data, true);
    if (!result) {
        //if data === "## name:    Serial Gateway" debug output
        adapter.log.warn('Cannot parse data: ' + data);
        return;
    }
    for (var i = 0; i < result.length; i++) {
        this.onDataPacket(result[i], client)
    }
};

var subTypeMappings = {
    'V_LIGHT':  'V_STATUS',
    'V_DIMMER': 'V_PERCENTAGE',
    'V_DUST_LEVEL': 'V_LEVEL'
};


MySensors.prototype.onDataPacket = function (res, client) {
    var self = this;
    if ((adapter.common.loglevel == 'debug') && (res.num.type != C_INTERNAL && res.num.subType != I_HEARTBEAT_RESPONSE)) {
        adapter.log.debug(
            sprintf('Got from %s: %3s; %3s; %-17s %s; %-28s %s',
                (client.ip ? client.ip : ''),
                res.id,
                res.childId,
                res.type + ';',
                (res.ack ? 'ACK_TRUE ' : 'ACK_FALSE'),
                res.subType + ';',
                res.payload
            ));
    }

    //var __id = fullIdFromPacket(ip, res);
    var id = findDevice(res, client.ip);
    if (this.pendingCommands.cnt) this.pendingCommands.check(res.num.id, client.ip);

    switch (res.num.type) {

        ////////////////////////////////////////////////////////////////////////////////////////////////////////////
        case C_PRESENTATION:
            if (id || !checkInclusion(res) || !res.subType)
                break;
            adapter.log.debug('ID not found. Try to add to to DB');
            createNode(res, client.ip, client.port);
            break;

        ////////////////////////////////////////////////////////////////////////////////////////////////////////////
        case C_REQ:
            if (!id) {
                id = fullIdFromPacket(client.ip, res);
                if (checkInclusion(res)) {
                    if (!devices[id]) {
                        adapter.log.debug('ID not found. Try to add to to DB');
                        createStateFromPacket(client.ip, res, undefined, id);
                    }
                }
            }

            switch (res.subType) {
                default:
                    adapter.getState(id, function (err, state) {
                        if (!state || err) state = {val: ""};
                        self.write(res.id + ';' + res.childId + ';1;0;' + res.num.subType + ';' + state.val, client.ip);
                    });
                    break;
            }
            break;

        ////////////////////////////////////////////////////////////////////////////////////////////////////////////
        case C_SET:
            // If set quality
            if (res.subType == 77) {
                // adapter.log.debug('subType = 77');
                // for (var _id in devices) {
                //     if (devices[_id].native &&
                //         (!client.ip || client.ip == devices[_id].native.ip) &&
                //         devices[_id].native.id == res.id &&
                //         devices[_id].native.childId == res.childId) {
                //         adapter.log.debug('Set quality of ' + (devices[id].common.name || _id) + ' ' + res.childId + ': ' + res.payload + ' ' + typeof res.payload);
                //         adapter.setState(_id, {q: typeof res.payload}, true);
                //     }
                // }
            } else {
                var v = subTypeMappings[res.subType];
                if (v !== undefined) res.subType = v;
                // if (res.subType === 'V_LIGHT')  res.subType = 'V_STATUS';
                // if (res.subType === 'V_DIMMER') res.subType = 'V_PERCENTAGE';
                // if (res.subType === 'V_DUST_LEVEL') res.subType = 'V_LEVEL';

                if(res.ack) {
                    adapter.log.debug('ack needed');
                }
                saveResult(id, res, client.ip);
            }
            break;

        ////////////////////////////////////////////////////////////////////////////////////////////////////////////
        case C_INTERNAL:
            var saveValue = false;
            //var _id = fullIdFromPacket(ip, res);
            switch (res.num.subType) {
                case I_DEBUG:
                case I_BATTERY_VOLTAGE:
                case I_BATTERY_LEVEL:
                    saveValue = true;
                    break;

                case I_TIME:              //   1   Sensors can request the current time from the Controller using this message. The time will be reported as the seconds since 1970
                    adapter.log.debug('Time ' + (client.ip ? ' from ' + client.ip + ' ' : '') + ':' + res.payload);
                    if (!res.ack) {
                        this.mysSend(res.id, res.childId, C_INTERNAL, ACK_TRUE, res.subType, Math.round(new Date().getTime() / 1000), client.ip);
                    }
                    break;

                case I_SKETCH_VERSION:
                case I_VERSION:           //   2   Used to request gateway version from controller.
                    adapter.log.debug(res.subType + (client.ip ? ' from ' + client.ip + '' : '') + ': ' + res.payload);
                    saveValue = true;
                    if (!res.ack && res.num.subType === I_VERSION) {
                        this.mysSend(res.id, res.childId, C_INTERNAL, ACK_TRUE, res.subType, (adapter.version || 0), ip);
                    }
                    break;

                case I_SKETCH_NAME:
                    adapter.log.debug(res.subType + (client.ip ? ' from ' + client.ip + '' : '') + ': ' + res.payload);
                    saveValue = true;
                    if (!checkInclusion(res)) {
                        break;
                    }
                    var name = res.payload;
                    var _id = meta._getId(client.ip, res);
                    adapter.getObject(_id, function (err, obj) {
                        if (!obj) {
                            obj = {type: 'device', common: {name: name}, native: { id: res.id, ip: client.ip}}
                        } else if (obj.common.name === name) {
                            return;
                        }
                        obj.common.name = name;
                        adapter.setObject(adapter.namespace + '.' + _id, obj, function (err) {
                            createDefaultCommands(adapter.namespace + '.' + _id, res.id, client.ip);
                        });
                    });
                    break;

                case I_INCLUSION_MODE:
                    adapter.log.debug('inclusion mode ' + (client.ip ? ' from ' + client.ip + ' ' : '') + ':' + res.payload ? 'STARTED' : 'STOPPED');
                    if (inclusionOn != res.payload && (res.payload)) {
                        this.commands.inclusionOn(res.payload);
                    }
                    break;

                case I_CONFIG:
                    res.payload = (res.payload == 'I') ? 'Imperial' : 'Metric';
                    adapter.log.debug(res.subType + (client.ip ? ' from ' + client.ip : '') + ': ' + res.payload);
                    config[client.ip || 'serial'] = config[client.ip || 'serial'] || {};
                    config[client.ip || 'serial'].metric = res.payload;
                    //this.mysSend(NODE_SENSOR_ID/*res.id*/, res.childId, C_INTERNAL, ACK_FALSE, I_CONFIG, 'M', ip);
                    saveValue = true;
                    break;

                case I_LOG_MESSAGE:
                    adapter.log.debug('I_LOG_MESSAGE' + (client.ip ? ' from ' + client.ip : '') + ': ' + res.payload);
                    break;

                case I_ID_REQUEST:
                    if (checkInclusion(res, 'Received I_ID_REQUEST, but inclusion mode is disabled')) {
                        // find free node-id
                        var iDs = [];
                        for (var _id in devices) {
                            if (devices[_id].native && (!client.ip || client.ip == devices[_id].native.ip)) {
                                iDs[parseInt(devices[_id].native.id)] = 1;
                            }
                        }
                        var minId;
                        for (minId=1; iDs[minId]; minId++) {
                        }
                        if (!res.ack) {  //???
                            this.mysSend(res.id, res.childId, C_INTERNAL, ACK_FALSE, I_ID_RESPONSE, minId, client.ip);
                        }
                    }
                    break;
                case I_GATEWAY_READY:
                    gatewayReady = true;
                    client.gatewayReady = true;
                    setInclusionState(true); // switch inclusion mode of after timeout.
                    break;
                case I_HEARTBEAT_RESPONSE:
                    break;
                case I_FIND_PARENT:
                    //??
                    //this.mysSend(res.id, res.childId, /*NODE_SENSOR_ID,*/ C_INTERNAL, ACK_FALSE, I_FIND_PARENT_RESPONSE, 0);
                    break;

                case I_DISCOVER_RESPONSE:
                    break;
                    
                default:
                    adapter.log.warn('Received unprocessed INTERNAL message: ' + res.subType + ': ' + res.payload);

            }

            if (saveValue) {
                saveResult(id, res, client.ip, true);
            }
            break;

        ////////////////////////////////////////////////////////////////////////////////////////////////////////////
        case C_STREAM:
            switch (res.num.subType) {
                case ST_FIRMWARE_CONFIG_REQUEST:
                    //pushWord(payload, result.type);
                    //pushWord(payload, result.version);
                    //pushWord(payload, result.blocks);
                    //pushWord(payload, result.crc);
                    //var sensor = NODE_SENSOR_ID;
                    //var command = C_STREAM;
                    //var acknowledge = 0; // no ack
                    //var type = ST_FIRMWARE_CONFIG_RESPONSE;
                    //mysSend(res.id, res.childId, C_STREAM, ACK_NO, ST_FIRMWARE_CONFIG_RESPONSE, '0000' + '0000' + '0000' + '0000', client.ip);
                    this.mysSend(res.id, res.childId, C_STREAM, ACK_NO, ST_FIRMWARE_CONFIG_RESPONSE, res.payload, client.ip); // no newer firmware

                    break;
                //case ST_FIRMWARE_CONFIG_RESPONSE:
                //    break;
                case ST_FIRMWARE_REQUEST:
                    break;
                //case ST_FIRMWARE_RESPONSE:
                //    break;
                case ST_SOUND:
                    break;
                case ST_IMAGE:
                    break;
            }
            break;
    }
};


MySensors.prototype.onConnectionChange = function(client) {
    adapter.setState(STATE_INFO_CONNECTION, client.connected, true);
    if (client.connected) {
        if (!client.gatewayReady) {
            this.write('0;0;' + C_INTERNAL + ';' + ACK_FALSE + ';' + I_CONFIG + ';get metric', client.ip);
            this.commands.requestPresentation(0, client.ip);
            setTimeout(function () {
                if (!client.gatewayReady) {
                    this.commands.requestReboot(0, client.ip);
                }
            }.bind(this), 1500);
        }
    } else {
        if(this.type == 'serial') {
            setTimeout(xrun, 500, this.type);
        }
    }
};

MySensors.prototype.destroy = function() {
    if (this.restartTimer) {
        ClearTimeout(this.restartTimer);
        delete this.restartTimmer;
    }
    MySensors.super_.prototype.destroy();
};

MySensors.prototype.onCreated = function (error) {
    mySensorsInterfaces[this.type] = this;
    mySensorsInterfacesLength = Object.keys(mySensorsInterfaces).length;
    
    if (error) {
        if (this.connectTries++ < 1 ) adapter.log.error('Failed to open ' + this.type + ' port: ' + error);
        this.restartTimer = setTimeout(xrun, 5000, type);
        return;
    }
    this.connectTries = 0;
    this.write('0;0;3;0;14;Gateway startup complete');
};

function xrun (type) {
    if (type == '') return;
    new MySensors(adapter, type);
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

function main() {

    checkInstanceObjects(false, function() {
        adapter.getState(STATE_INCLUSION_ON, function (err, state) {
            if (state == null) {
                checkInstanceObjects(true);
            }
            setInclusionState(state ? state.val : true);

            readExistingObjects(function () {

                var ar = [];
                if (adapter.config.comName) ar.push('serial');
                if (adapter.config.type && adapter.config.type !== 'serial' && adapter.config.type !== 'none') ar.push(adapter.config.type);
                ar.forEach(xrun);
                ar = null;

                adapter.subscribeStates('*');
                adapter.subscribeObjects('*');
            });
        });
    });
}
