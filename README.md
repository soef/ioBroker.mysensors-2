![Logo](admin/mysensors.png)
# ioBroker.mysensors-2
=================

This adapter communicates with [mysensors](http://www.mysensors.org) serial or ethernet gateway (TCP or UDP). 
It ethernet gateway selected in this case ioBroker is server, that expects connections.

## Version 2.0 Beta
Please remove all previous instances of versions lower than 2.0.    
The naming of devices, channels and states has changed. 

## Based on ioBroker.mysensors
https://github.com/ioBroker/ioBroker.mysensors

## Prerequires
To use serial port on Windows it is VS required to build the binary.
To use serial port on linux it is build-essential an python2.7 required. To install them just write:

```
sudo apt-get update
sudo apt-get install build-essential
sudo apt-get install python2.7
```

