import {describe,expect,it} from "vitest";
import mysql from "mysql2/promise";
import {mysqlConnectionOptions} from "./mysql-config.js";

describe("MySQL transport configuration",()=>{
  it("enables certificate and hostname verification in the actual driver for Azure",async()=>{
    for(const suffix of ["", "?ssl-mode=REQUIRED", "?ssl-mode=VERIFY_IDENTITY"]){
      const options=mysqlConnectionOptions(`mysql://user:example@fixture.mysql.database.azure.com:3306/axiocred${suffix}`);
      const pool=mysql.createPool(options); // Pools are lazy; no network connection.
      try {
        const driver=pool.pool.config as unknown as {connectionConfig:{ssl:unknown}};
        expect(driver.connectionConfig.ssl).toMatchObject({rejectUnauthorized:true,verifyIdentity:true,minVersion:"TLSv1.2"});
        expect(options.uri).not.toContain("ssl-mode");
      }finally{await pool.end();}
    }
  });
  it("keeps local MySQL usable and rejects ambiguous or insecure TLS options",()=>{
    expect(mysqlConnectionOptions("mysql://user:example@127.0.0.1:3306/axiocred").ssl).toBeUndefined();
    expect(mysqlConnectionOptions("mysql://user:example@db.example:3306/axiocred?ssl-mode=REQUIRED").ssl).toMatchObject({verifyIdentity:true});
    for(const query of ["ssl-mode=DISABLED","ssl-mode=PREFERRED","ssl=false","ssl-mode="]){
      expect(()=>mysqlConnectionOptions(`mysql://user:example@fixture.mysql.database.azure.com/db?${query}`)).toThrow();
    }
  });
});
