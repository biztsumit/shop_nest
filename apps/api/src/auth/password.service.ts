import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import { randomBytes } from 'node:crypto';

// Passwords are never stored, only an Argon2id HASH: a one-way fingerprint. At login the typed
// password is hashed the same way and compared. Argon2id is deliberately slow and needs a lot
// of memory (19 MB per try here, the OWASP setting), so trying billions of guesses against a
// stolen database is impractically expensive. Each hash also has its own random "salt", so two
// people with the same password get different hashes.
@Injectable()
export class PasswordService {
  // A hash of a random password nobody knows, made once. See verifyOrWaste().
  private readonly dummyHash = hash(randomBytes(32).toString('hex'));

  hash(password: string): Promise<string> {
    return hash(password);   // the library's defaults ARE the OWASP recommendation: argon2id, m=19456, t=2, p=1
  }

  verify(passwordHash: string, password: string): Promise<boolean> {
    return verify(passwordHash, password);
  }

  // For an email that has no account: do the same slow work as a real check, then say no.
  // Otherwise "unknown email" answers in 2 ms and "wrong password" in 60 ms, and an attacker
  // can tell which emails have accounts just by timing the answers.
  async verifyOrWaste(passwordHash: string | undefined, password: string): Promise<boolean> {
    if (passwordHash === undefined) {
      await verify(await this.dummyHash, password);
      return false;
    }
    return this.verify(passwordHash, password);
  }
}
