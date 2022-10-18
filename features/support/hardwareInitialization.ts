import {After, Given} from "@cucumber/cucumber";
import WaremaWMSMock from "./WaremaWMSMock.js";
import WaremaWMS from "../../lib/WaremaWMS.js";

Given('a connection to the USB stick', async function () {
    this['wmsMock'] = new WaremaWMSMock();
    this['wms'] = new WaremaWMS(this['wmsMock'].getMockPort());
});

After(function () {
    this['wmsMock'].stop();
})
