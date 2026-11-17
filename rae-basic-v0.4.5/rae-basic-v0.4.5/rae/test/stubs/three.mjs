export class Vector3 { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } copy(v) { return this.set(v.x, v.y, v.z); } }
export class Group { constructor() { this.position = new Vector3(); this.rotation = { y: 0 }; this.children = []; } add(c) { this.children.push(c); } }
