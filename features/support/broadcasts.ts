import {Then, When} from "@cucumber/cucumber";
import {once} from "node:events";
import * as assert from "assert";

When('the weather station {string} broadcasts wind speed as {float}', async function (serial, windSpeed) {
    this['wmsMock'].mockWeatherBroadcast(serial, windSpeed);
});

Then('the stick emits a weather broadcast event from serial {string}, with wind speed {float} m\\/s', async function (serial, windSpeed) {
    [this['response']] = await once(this['wms'].frameHandler, '7080');
    assert.strictEqual(this['response'].serial, serial);
    assert.strictEqual(this['response'].windSpeed, windSpeed);
});
