import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const deriveKey = (password:string,salt:string) => new Promise<Buffer>((resolve,reject) => {
  scrypt(password,salt,64,(error,key) => error ? reject(error) : resolve(key as Buffer));
});

export async function hashPassword(password:string):Promise<string> {
  const salt=randomBytes(16).toString("hex");
  const key=await deriveKey(password,salt);
  return `scrypt$${salt}$${key.toString("hex")}`;
}

export async function verifyPassword(password:string,stored:string):Promise<boolean> {
  const [algorithm,salt,hex]=stored.split("$");
  if(algorithm!=="scrypt"||!salt||!hex)return false;
  const expected=Buffer.from(hex,"hex");
  const actual=await deriveKey(password,salt);
  return expected.length===actual.length&&timingSafeEqual(expected,actual);
}

