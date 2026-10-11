import { describe, expect, it } from "vitest";

import { describeGraphQuery, matchesGraphQuery, parseGraphQuery, type GraphPerson } from "./search";

const person = (o: Partial<GraphPerson> & { id: string }): GraphPerson => ({ relations: ["friends"], roles: [], profileType: "personal", location: null, bio: null, skills: [], schools: [], ...o });

const NET: GraphPerson[] = [
  person({ id: "uni", schools: ["University of Lagos"] }),
  person({ id: "partner", relations: ["pro"], roles: ["partner"], location: "Lagos, Nigeria" }),
  person({ id: "partnerAbuja", relations: ["pro"], roles: ["partner"], location: "Abuja" }),
  person({ id: "photog", relations: ["following"], profileType: "creator", bio: "Street photography and portraits" }),
  person({ id: "member", relations: ["community"] }),
  person({ id: "aiCollab", relations: ["collaborators"], bio: "AI video artist" }),
  person({ id: "mentor", relations: ["pro", "trusted"], roles: ["mentor"] }),
  person({ id: "stranger", relations: ["followers"], profileType: "creator", bio: "photography" }),
];

const run = (q: string) => NET.filter((p) => matchesGraphQuery(p, parseGraphQuery(q), ["University of Lagos"])).map((p) => p.id);

describe("graph search — the brief's examples", () => {
  it("answers each one exactly", () => {
    expect(run("Friends from university.")).toEqual(["uni"]);
    expect(run("Business partners in Lagos.")).toEqual(["partner"]);
    expect(run("Photography creators I know.")).toEqual(["photog"]);
    expect(run("People from my community.")).toEqual(["member"]);
    expect(run("AI collaborators.")).toEqual(["aiCollab"]);
    expect(run("Trusted mentors.")).toEqual(["mentor"]);
  });
  it("'people I know' never includes someone who only follows you", () => {
    expect(run("photography creators I know")).not.toContain("stranger");
    expect(run("my followers")).toEqual(["stranger"]);
  });
  it("says what it understood", () => {
    expect(describeGraphQuery(parseGraphQuery("Business partners in Lagos"))).toContain("in lagos");
    expect(parseGraphQuery("trusted mentors").roles).toEqual(["mentor"]);
  });
});
