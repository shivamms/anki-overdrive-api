import {VehicleScanner} from "../../src/core/vehicle/vehicle-scanner";
import {Vehicle} from "../core/vehicle/vehicle-interface";
import {getCommonBasePathOfArray} from "gulp-typescript/release/utils";
import {isNullOrUndefined} from "util";

const readline = require('readline');

let vehicles: Array<Vehicle>;

console.log("scanning vehicles...");
let scanner = new VehicleScanner();
scanner.findAll().then((vehicles)=>{
    this.vehicles = vehicles;
    vehicles.forEach(function(vehicle, index) {
        console.log("use index " + index + " for car id: " + vehicle.id);
    });
    initializePrompt(this.vehicles);
});

function initializePrompt(vehicles){

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: 'ANKI> '
    });


    rl.prompt();

    rl.on('line', (line) => {
        line = line.trim();
        let input: string[] = line.split(' ');
        let command = input[0];
        let index: number = input[1];

        if(index < 0 || index > vehicles.length) {
            console.log("car not found.");
            return;
        }
        switch(command) {
            case 'help':
                console.log('Available commands:\n' +
                    'c [carId] - connect to car\n' +
                    'd [carId] - disconnect from car\n' +
                    's [carId] [speed] [accelaration] - set speed and accelaration of car\n');
                break;
            case 'c':
                vehicles[index].connect().then(()=>{
                    console.log("car connected");
                });
                break;
            case 's':
                let speed: number = input[2];
                let accelaration: number = input[3];
                speed = isNullOrUndefined(speed) ? 200 : speed;
                accelaration = isNullOrUndefined(accelaration) ? 50 : accelaration;
                try {
                    vehicles[index].setSpeed(speed, accelaration);
                }
                catch(e){
                    if(e.message === "Cannot read property 'write' of undefined")
                        console.log("error. car is not connected!");
                }
                break;
            case 'd':
                vehicles[index].disconnect().then(()=>{
                    console.log("car disconnected");
                });
                break;
            default:
                console.log('command not found');
                break;
        }
        rl.prompt();
    }).on('close', () => {
        console.log('Good bye. Thank you for using anki!');
        process.exit(0);
    });
}
