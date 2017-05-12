import {Settings} from "../../core/settings/settings-interface";
import {JsonSettings} from "../../core/settings/json-settings";
import {VehicleScanner} from "../../core/vehicle/vehicle-scanner";
import {isNullOrUndefined} from "util";
import {Vehicle} from "../../core/vehicle/vehicle-interface";
import {KafkaDistanceFilter} from "./kafka-distance-filter";
import {Piece} from "../../core/track/piece-interface";
import {Start} from "../../core/track/start";
import {Finish} from "../../core/track/finish";
import {Straight} from "../../core/track/straight";
import {Curve} from "../../core/track/curve";
import {KafkaController} from "./kafka-controller";
import {Setup} from "../../core/setup";
import {AnkiConsole} from "../../core/util/anki-console";
import {Scenario} from "../scenario/scenario-interface";
import {CollisionScenario} from "../scenario/collision-scenario";
import {LightConfig} from "../../core/vehicle/light-config";
import {AntiCollisionScenario} from "../scenario/anti-collision-scenario";
import {MaxSpeedScenario} from "../scenario/max-speed-scenario";
import {PositionUpdateMessage} from "../../core/message/v2c/position-update-message";
import * as log4js from "log4js";
import {KafkaVehicleController} from "./kafka-vehicle-controller";
import {WebSocketController} from "../websocket/websocket-controller";
/// <reference path="../../../decl/jsonfile.d.ts"/>
import {KafkaRoundFilter} from "./kafka-round-filter";

let settings: Settings = new JsonSettings(),
    setup: Setup = settings.getAsSetup("setup"),
    scanner = new VehicleScanner(setup),
    track = settings.getAsTrack("setup.track.pieces"),
    vehicleConfig: Array<{ offset: number, vehicle: Vehicle }> = [],
    usedVehicles: Array<Vehicle> = [],
    vehicleControllers: Array<KafkaVehicleController> = [],
    filter: KafkaDistanceFilter,
    kafkaController = new KafkaController(),
    ankiConsole = new AnkiConsole(),
    websocket: WebSocketController,
    scenario: Scenario,
    resetTimeouts: { [key: string]: number } = {
        "eb401ef0f82b": 0,
        "ed0c94216553": 1000
    };


log4js.configure({
    appenders: [
        {type: 'console'},
        {type: 'file', filename: 'logs/setup.log', category: 'setup'}
    ]
});

process.setMaxListeners(100);

let logger = log4js.getLogger("setup");

function handleError(e: Error): void {
    if (!isNullOrUndefined(e)) {
        console.error(e);
        process.exit();
    }
}
process.on('exit', () => {
    setup.online = false;
    let message = JSON.stringify(setup).replace(/_/g, "");
    logger.info("Shutting down setup: " + message);
    kafkaController.sendPayload([{
        topic: "setup",
        partitions: 1,
        messages: message
    }]);

    logger.info("Interrupting running scenario.");
    if (!isNullOrUndefined(scenario) && scenario.isRunning())
        scenario.interrupt().catch(e => logger.error("Error while interrupting scenario", e));

    logger.info("Disconnecting vehicles...");
    vehicleConfig.forEach(config => {
        config.vehicle.disconnect();
    });

    logger.info("Setup disconnected.");
});

// Because many listeners are used in process.
process.setMaxListeners(1000);

function getPieceDescription(piece: Piece) {
    if (piece instanceof Start)
        return "Start";
    else if (piece instanceof Finish)
        return "Finish";
    else if (piece instanceof Straight)
        return "Straight";
    else if (piece instanceof Curve)
        return "Curve";
    return "Undefined";
}

function initializeVehicles(handler?: (vehicle: Vehicle, initialOffset?: number) => any) {
    usedVehicles.forEach(vehicle => {
        vehicle.setLights([
            new LightConfig()
                .blue()
                .steady(),
            new LightConfig()
                .green()
                .steady(0),
            new LightConfig()
                .red()
                .steady(0)
        ]);
        vehicle.setLights([
            new LightConfig()
                .tail()
                .steady(0),
            new LightConfig()
                .front()
                .steady(0),
            new LightConfig()
                .weapon()
                .steady(0)
        ]);

        if (!isNullOrUndefined(handler))
            setup.vehicles.forEach(config => {
                if (config.uuid === vehicle.id)
                    handler(vehicle, config.offset);
            });

    });
}

function findStartLane() {
    let counters: { [key: string]: number } = {};
    usedVehicles.forEach(vehicle => {
        counters[vehicle.id] = 0;
        let listener = (message: PositionUpdateMessage) => {
            if (message.piece === 34 && message.position === 0 && counters[message.vehicleId] === 1) {
                vehicle.removeListener(listener);
                counters[message.vehicleId] = 0;
                vehicle.setSpeed(0, 1000);
                vehicle.setLights([
                    new LightConfig()
                        .blue()
                        .steady(),
                    new LightConfig()
                        .green()
                        .steady(0),
                    new LightConfig()
                        .weapon()
                        .steady(0)
                ]);
            } else if (message.piece === 34 && message.position === 0)
                counters[message.vehicleId] = 1;
        };

        vehicle.addListener(listener);
        vehicle.setLights([
            new LightConfig()
                .blue()
                .steady(0),
            new LightConfig()
                .green()
                .flash(0, 10, 10),
            new LightConfig()
                .weapon()
                .flash(0, 10, 10)
        ]);
        setTimeout(() => {

            setup.vehicles.forEach(config => {
                if (config.uuid === vehicle.id) {
                    vehicle.setSpeed(500, 250);
                    setTimeout(() => {
                        vehicle.changeLane(config.offset);
                    }, 2000);
                }

            });
        }, resetTimeouts[vehicle.id] || 0);
    });
}


function createScenario(name: string) {
    switch (name) {
        case  'collision':
            return new CollisionScenario(usedVehicles[0], usedVehicles[1])
        case 'anti-collision':
            return new AntiCollisionScenario(usedVehicles[0], usedVehicles[1]);
        case 'max-speed' :
            return new MaxSpeedScenario(usedVehicles[0]);
        default:
            return null;
    }
}

logger.info("Starting setup...")
logger.info("Starting Kafka Producer...");
kafkaController.initializeProducer().then(online => {
    if (!online) {
        logger.error("Kafka Server is not running.");
        process.exit();
    }

    logger.info("Searching vehicles...");
    scanner.findAll().then(vehicles => {
        vehicles.forEach(vehicle => {
            setup.vehicles.forEach(config => {
                vehicleConfig.push({
                    offset: config.offset,
                    vehicle: vehicle
                });
            });
            usedVehicles.push(vehicle);
        });

        if (vehicleConfig.length === 0) {
            logger.info("No vehicles found for this setup.");
            process.exit();
        }

        if (isNullOrUndefined(track)) {
            logger.info("No track found for this setup");
            process.exit()
        }


        logger.info("Found " + vehicles.length + " vehicles:");
        let i = 1;
        usedVehicles.forEach(vehicle => {
            let controller = new KafkaVehicleController(vehicle);
            logger.info("\t" + i++ + "\t" + vehicle.id + "\t" + vehicle.address);

            controller.start().then(() => {
                vehicleControllers.push(controller);
            }).catch(handleError);
        });

        i = 0;

        logger.info("Found 1 track for setup:")
        track.eachPiece(piece => {
            logger.info("\t" + i++ + "\t" + piece.id + "\t(" + getPieceDescription(piece) + ")");
        });

        logger.info("Starting distance filter...");
        filter = new KafkaDistanceFilter(usedVehicles, track, "vehicle-data");
        filter.start().catch(handleError);

        logger.info("Connecting vehicles...");
        usedVehicles.forEach(vehicle => vehicle.connect());

        // Wait 3 seconds before interacting with the resources.
        setTimeout(() => {
            initializeVehicles((vehicle, offset) => {
                // setInterval(() => {
                //     vehicle.queryBatteryLevel();
                // }, 1000);
                logger.info("Initialize [" + vehicle.id + "] with offset [" + offset + "mm].")
                vehicle.setOffset(offset);
                vehicle.disconnect();
            });

            websocket = new WebSocketController(usedVehicles, 4711);

            setup.online = true;


            let message = JSON.stringify(setup).replace(/_/g, "");


            logger.info("Sending setup to 'setup': " + message);
            kafkaController.sendPayload([{
                topic: "setup",
                partitions: 1,
                messages: message
            }]);

            logger.info("Initializing Kafka Consumer for topic 'scenario'...");


            kafkaController.initializeConsumer([{topic: "scenario", partition: 0}], 0);
            kafkaController.addListener(message => {
                let info: { name: string, interrupt: boolean } = JSON.parse(message.value);
                logger.info("Received message from server: " + JSON.stringify(message));
                if (info.interrupt && !isNullOrUndefined(scenario)) {
                    scenario.interrupt().then(() => {
                        initializeVehicles();
                        scenario = null;
                        filter.unregisterUpdateHandler();
                        findStartLane();
                        logger.info("Interrupted scenario '" + info.name + "'.");
                    }).catch(handleError);
                } else {
                    if (!isNullOrUndefined(scenario) && scenario.isRunning()) {
                        logger.warn("Another scenario is still running!");
                    } else {
                        scenario = createScenario(info.name);
                        if (isNullOrUndefined(scenario)) {
                            logger.error("Unknown Scenario for config: " + info);
                        } else {
                            filter.registerUpdateHandler(scenario.onUpdate, scenario);
                            scenario.start().then(() => {
                                logger.info("Starting scenario: " + scenario)
                                // initializeVehicles();
                                // scenario = null;
                                // filter.unregisterUpdateHandler();
                                // findStartLane();
                            }).catch(handleError);
                        }
                    }
                }
            });

            logger.info("Waiting for messages.");
            ankiConsole.initializePrompt(usedVehicles);

            // setTimeout(() => {
            //     scenario = new AntiCollisionScenarioCollecting(usedVehicles[0], usedVehicles[1]);
            //     filter.registerUpdateHandler(scenario.onUpdate, scenario);
            //     scenario.start().catch(handleError);
            // }, 2000);

            let skull: Vehicle = null;

            usedVehicles.forEach(vehicle => {
                if (vehicle.id === "ed0c94216553")
                    skull = vehicle;
            });



            // if (!isNullOrUndefined(skull)) {
            //
            //
            //     let roundFilter = new KafkaRoundFilter(skull, track, "vehicle-data");
            //     roundFilter.start().then(() => {
            //         logger.info("Sending messages for completed rounds.");
            //     }).catch(error => {
            //         logger.error("Cannot start round filter.", error);
            //     });
            //
            //     setInterval(() => {
            //         skull.queryBatteryLevel()
            //             .then(level => {
            //                 logger.info("battery level for skull: " + level);
            //             });
            //     });
            //
            // }


        }, 3000);

    }).catch(handleError);

}).catch(handleError);





