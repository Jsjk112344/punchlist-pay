"use client";
import {useEffect,useState} from "react";
import type {WorkOrder} from "./types";
import {seedOrders} from "./fixtures";
const KEY="punchlist-pay-ui-fixture-v1";
const CHANGE="punchlist:changed";
export function readOrders():WorkOrder[]{
 if(typeof window==="undefined")return seedOrders;
 try{const raw=window.localStorage.getItem(KEY);return raw?JSON.parse(raw) as WorkOrder[]:seedOrders}catch{return seedOrders}
}
export function writeOrders(next:WorkOrder[]){if(typeof window==="undefined")return;
 window.localStorage.setItem(KEY,JSON.stringify(next));window.dispatchEvent(new Event(CHANGE));
}
export function updateOrder(id:string,fn:(old:WorkOrder)=>WorkOrder){writeOrders(readOrders().map(o=>o.id===id?fn(o):o))}
export function insertOrder(order:WorkOrder){writeOrders([order,...readOrders()])}
export function resetDemo(){writeOrders(seedOrders)}
export function useOrders(){const[orders,setOrders]=useState<WorkOrder[]>(seedOrders);
 useEffect(()=>{const update=()=>setOrders(readOrders());update();window.addEventListener(CHANGE,update);window.addEventListener("storage",update);
 // Fixture-mode cross-window polling makes phone-frame + desktop demos visibly update even without backend.
 const interval=window.setInterval(update,1300);
 return()=>{window.removeEventListener(CHANGE,update);window.removeEventListener("storage",update);window.clearInterval(interval)}},[]);
 return orders;
}
