import {After, Given} from "@cucumber/cucumber";
import WaremaWMSMock from "./WaremaWMSMock.js";
import WaremaWMS from "../../lib/WaremaWMS.js";

Given('a connection to the USB stick', async function () {
    this['wmsMock'] = new WaremaWMSMock();
    this['wms'] = new WaremaWMS(this['wmsMock'].getMockPort());
    // The serial port library doesn't properly open the mock port until some data is sent.
    // This will cause errors when injecting responses, so let's call `getName` to send some data and make it happy
    await this['wms'].getName();
});

After(function () {
    this['wmsMock'].stop();
})
