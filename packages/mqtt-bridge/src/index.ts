import mqtt from "mqtt";

const brokerUrl = process.env["MQTT_BROKER"] ?? "mqtt://localhost:1883";

const client = mqtt.connect(brokerUrl);

client.on("connect", () => {
  console.log("MQTT Bridge connected to broker at", brokerUrl);
});

client.on("error", (err) => {
  console.error("MQTT error:", err);
});

export { client };
export default client;
