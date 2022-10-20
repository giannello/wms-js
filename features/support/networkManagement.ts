import {Then, When} from "@cucumber/cucumber";
import {once} from "node:events";
import * as assert from "assert";

When('the device {string} sends a network parameters change request for channel {string} and panId {string}', async function (serial, channel, panId) {
    this['wmsMock'].mockNetworkParametersChangeBroadcast(serial, channel, panId);
});

Then('the stick receives a request to change the network parameters to channel {float} and panId {string} from device {string}', async function (channel, panId, serial) {
    [this['response']] = await once(this['wms'].frameHandler, '5060');
    assert.strictEqual(this['response'].serial, serial);
    assert.strictEqual(this['response'].channel, channel);
    assert.strictEqual(this['response'].panId, panId);
});
