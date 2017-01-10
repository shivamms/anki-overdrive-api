/// <reference path="../../decl/noble.d.ts"/>
import {Peripheral, Characteristic} from "noble";
import {Vehicle} from "./vehicle-interface";
import {VehicleMessage} from "./vehicle-message";
import {PositionUpdateMessage} from "./position-update-message";
import {TransitionUpdateMessage} from "./transition-update-message";
import {IntersectionUpdateMessage} from "./intersection-update-message";
import {TurnType} from "./turn-type";

class AnkiOverdriveVehicle implements Vehicle {

    private _id: string;
    private _address: string;
    private _name: string;
    private _peripheral: Peripheral;
    private _read: Characteristic;
    private _write: Characteristic;
    private _listeners: Array<(message: VehicleMessage) => any> = [];

    constructor(peripheral: Peripheral, name?: string) {
        this._id = peripheral.id;
        this._address = peripheral.address;
        this._name = name;
        this._peripheral = peripheral;
    }

    connect(): Promise<void> {
        let me = this;

        return new Promise<void>((resolve, reject) => {
            me._peripheral.connect((e: Error) => {
                if (e)
                    reject(e);
                else
                    me.initCharacteristics()
                        .then(() => {
                            me.setSdkMode(true);
                            resolve();
                        })
                        .catch(reject);
            });
        });
    }

    disconnect(): Promise<void> {
        let me = this;

        return new Promise<void>((resolve, reject) => {
            me._peripheral.disconnect((e: Error) => {
                if (e)
                    reject(e);

                resolve();
            });
        });
    }

    setSpeed(speed: number, acceleration?: number): void {
        let data = new Buffer(7);

        data.writeUInt8(6, 0);
        data.writeUInt8(0x24, 1); // ANKI_VEHICLE_MSG_C2V_SET_SPEED
        data.writeUInt16LE(speed, 2);
        data.writeUInt16LE(acceleration || 500, 4);

        this._write.write(data);
    }

    setOffset(offset: number): void {
        let data = new Buffer(6);

        data.writeUInt8(5, 0);
        data.writeUInt8(0x2c, 1); // ANKI_VEHICLE_MSG_C2V_SET_OFFSET_FROM_ROAD_CENTER
        data.writeFloatLE(offset, 2);

        this._write.write(data);
    }

    changeLane(offset: number, speed?: number, acceleration?: number): void {
        let data = new Buffer(12);

        data.writeUInt8(11, 0);
        data.writeUInt8(0x25, 1); // ANKI_VEHICLE_MSG_C2V_CHANGE_LANE
        data.writeUInt16LE(speed || 500, 2);
        data.writeUInt16LE(acceleration || 500, 4);
        data.writeFloatLE(offset, 6);

        this._write.write(data);
    }

    turnLeft(): void {
        this.turn(TurnType.VEHICLE_TURN_LEFT);
    }

    turnRight(): void {
        this.turn(TurnType.VEHICLE_TURN_RIGHT);
    }

    uTurn(): void {
        this.turn(TurnType.VEHICLE_TURN_UTURN);
    }

    uTurnJump(): void {
        this.turn(TurnType.VEHICLE_TURN_UTURN_JUMP);
    }

    setSdkMode(on: boolean): void {
        let data = new Buffer(4);

        data.writeUInt8(3, 0);
        data.writeUInt8(0x90, 1); // ANKI_VEHICLE_MSG_C2V_SDK_MODE
        data.writeUInt8(on ? 0x1 : 0x0, 2);
        data.writeUInt8(0x1, 3);

        this._write.write(data);
    }

    queryPing(): Promise<number> {
        return null;
    }

    queryVersion(): Promise<number> {
        return null;
    }

    addListener(listener: (message: VehicleMessage) => any): void {
        this._listeners.push(listener);
    }

    removeListener(listener: (message: VehicleMessage) => any): void {
        for (var i = 0; i < this._listeners.length; ++i) {
            if (this._listeners[i] === listener)
                this._listeners.splice(i, 1);
        }
    }

    private initCharacteristics(): Promise<void> {
        let me = this;

        return new Promise<void>((resolve, reject) => {
            me._peripheral.discoverAllServicesAndCharacteristics((e, services, characteristics) => {
                if (e)
                    reject(e);

                characteristics.forEach((characteristic) => {
                    if (characteristic.uuid === "be15bee06186407e83810bd89c4d8df4")
                        me._read = characteristic;
                    else if (characteristic.uuid === "be15bee16186407e83810bd89c4d8df4")
                        me._write = characteristic;
                });

                if (!me._write || !me._write)
                    reject(new Error(("Could not initialise read/write characteristics.")));

                me._read.subscribe();
                me.enableDataEvents();
                resolve();
            });
        });
    }

    private enableDataEvents(): void {
        let me = this;

        this._read.on('data', (data: Buffer) => {
            var id = data.readUInt8(1),
                message: VehicleMessage;

            if (id === 0x27) // ANKI_VEHICLE_MSG_V2C_LOCALIZATION_POSITION_UPDATE
                message = new PositionUpdateMessage(data, me._id);
            else if (id === 0x29) // ANKI_VEHICLE_MSG_V2C_LOCALIZATION_TRANSITION_UPDATE
                message = new TransitionUpdateMessage(data, me._id);
            else if (id === 0x2a) //ANKI_VEHICLE_MSG_V2C_LOCALIZATION_INTERSECTION_UPDATE
                message = new IntersectionUpdateMessage(data, me._id);

            me._listeners.forEach((listener) => {
                listener(message);
            });
        });
    }

    private turn(type: TurnType): void {
        let data = new Buffer(4);

        data.writeUInt8(3, 0);
        data.writeUInt8(0x32, 1); // ANKI_VEHICLE_MSG_C2V_TURN
        data.writeUInt8(type, 2);

        this._write.write(data);
    }


    get id(): string {
        return this._id;
    }

    get address(): string {
        return this._address;
    }

    get name(): string {
        return this._name;
    }
}

export {AnkiOverdriveVehicle}