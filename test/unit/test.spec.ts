import {expect} from "chai";
import {Test} from "../../lib/test";

describe("Test", () => {

    it("should say hello world", () => {
       const test = new Test()

       // expect(true).to.be.true
       expect(test.helloWorld()).to.equal("Hello, World!")
    })

    it("multiplies", () => {
      const test = new Test()

      expect(test.mulitply(1, 1)).to.equal(1)
    })

})