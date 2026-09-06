import logger from "node-color-log";

const app = logger.createNamedLogger("APP");
const oai = logger.createNamedLogger("OAI");
const plv = logger.createNamedLogger("PLV");

const log = {
  get app() {
    return app.color("white");
  },

  get oai() {
    return oai.color("cyan");
  },

  get plv() {
    return plv.color("magenta");
  },
};

export default log;
