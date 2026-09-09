import {describe,expect,it,vi} from "vitest";
import type {Pool} from "mysql2/promise";
import {MySQLStore} from "./mysql-store.js";

describe("PayPal transactional processing",()=>{
  it.each(["INSERT INTO subscriptions","UPDATE workspaces","UPDATE webhook_events"])("rolls back a failure at %s and permits retry",async(failure)=>{
    let committed=false,staged=false,failOnce=true;
    const execute=vi.fn(async(sql:string)=>{
      if(sql.startsWith("INSERT IGNORE")){const duplicate=committed;staged=true;return [{affectedRows:duplicate?0:1}];}
      if(failOnce&&sql.startsWith(failure)){failOnce=false;throw new Error("Synthetic database failure");}
      return [{affectedRows:1}];
    });
    const connection={execute,beginTransaction:vi.fn(async()=>{staged=false;}),commit:vi.fn(async()=>{committed=staged;}),rollback:vi.fn(async()=>{staged=false;}),release:vi.fn()};
    const pool={getConnection:async()=>connection} as unknown as Pool;
    const store=new MySQLStore(pool);
    const subscription={id:"fixture",plan:"business" as const,status:"ACTIVE"};
    await expect(store.recordPayPalEvent("fixture-event","activated",{},subscription)).rejects.toThrow("Synthetic database failure");
    expect(committed).toBe(false);expect(connection.rollback).toHaveBeenCalledOnce();
    expect(await store.recordPayPalEvent("fixture-event","activated",{},subscription)).toEqual({duplicate:false});
    const writes=execute.mock.calls.length;
    expect(await store.recordPayPalEvent("fixture-event","activated",{},subscription)).toEqual({duplicate:true});
    expect(execute.mock.calls.length-writes).toBe(1);
    expect(connection.release).toHaveBeenCalledTimes(3);
  });
});
