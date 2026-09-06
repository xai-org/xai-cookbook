import logger from "node-color-log";

const app = logger.createNamedLogger("APP");
const oai = logger.createNamedLogger("OAI");
const twl = logger.createNamedLogger("TWL");

const log = {
  get app() {
    return app.color("white");
  },

  get oai() {
    return oai.color("cyan");
  },

  get twl() {
    return twl.color("magenta");
  },
};

export default log;
