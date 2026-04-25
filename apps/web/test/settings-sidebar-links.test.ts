import { describe, expect, it } from "vitest"

import { settingsSidebarBackLink } from "../src/components/settings/settings-sidebar-links"

describe("settings sidebar links", () => {
  it("points the back link to the profile page", () => {
    expect(settingsSidebarBackLink).toEqual({
      href: "/profile",
      label: "Профиль",
    })
  })
})
