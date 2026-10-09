import {
  FileUploadBuilder,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { canUseAnnouncement } from "../services/permissionService.js";
import { createAnnouncementSession } from "../services/announcementService.js";

export async function handleThongbaoCommand(interaction) {
  if (!canUseAnnouncement(interaction)) {
    await interaction.reply({
      content: "Bạn không có quyền để dùng lệnh /thongbao trong server này.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const channelId = interaction.options.getString("kenh", true);
  await interaction.guild.channels.fetch();
  await interaction.guild.roles.fetch();
  const roleValues = Array.from({ length: 5 }, (_, index) =>
    interaction.options.getString(`role${index + 1}`),
  ).filter(Boolean);
  const roleIds = roleValues.filter(
    (value) => !["everyone", "here"].includes(value),
  );
  const specialMentions = roleValues.filter((value) =>
    ["everyone", "here"].includes(value),
  );
  if (
    new Set(roleValues).size !== roleValues.length ||
    specialMentions.length > 1 ||
    roleValues.length > 5 ||
    roleIds.some(
      (roleId) =>
        roleId === interaction.guild.id ||
        !interaction.guild.roles.cache.has(roleId),
    )
  ) {
    await interaction.reply({
      content:
        "Có role bị trùng hoặc không còn thuộc server. Hãy chọn lại các role bằng Autocomplete.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const channel = interaction.guild.channels.cache.get(channelId);
  if (
    !channel ||
    ![0, 5].includes(channel.type) ||
    channel.guildId !== interaction.guild.id
  ) {
    await interaction.reply({
      content:
        "Kênh đã chọn không hợp lệ hoặc không thuộc server này. Hãy chạy lại /thongbao và tìm kênh khác.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const session = createAnnouncementSession({
    guildId: interaction.guild.id,
    userId: interaction.user.id,
    channelId,
    roleIds,
    specialMention: specialMentions[0] || null,
  });

  await interaction.showModal(
    await buildAnnouncementModal(interaction.guild, session),
  );
}

export async function handleThongbaoAutocomplete(interaction) {
  if (!canUseAnnouncement(interaction) || !interaction.guild) {
    await interaction.respond([]);
    return;
  }

  const focused = interaction.options.getFocused(true);
  if (/^role[1-5]$/.test(focused.name)) {
    await interaction.guild.roles.fetch();
    const focusedIndex = Number(focused.name.slice(4)) - 1;
    const selectedValues = Array.from({ length: 5 }, (_, index) =>
      index === focusedIndex
        ? null
        : interaction.options.getString(`role${index + 1}`),
    ).filter(Boolean);
    const selectedRoleIds = new Set(
      selectedValues.filter((value) => !["everyone", "here"].includes(value)),
    );
    const selectedSpecialMentions = new Set(
      selectedValues.filter((value) => ["everyone", "here"].includes(value)),
    );
    const roleQuery = focused.value
      .trim()
      .replace(/^@/, "")
      .toLocaleLowerCase();
    const specialOptions = [
      { name: "@everyone · nhắc toàn server", value: "everyone" },
      { name: "@here · nhắc người đang online", value: "here" },
    ].filter(
      (option) =>
        !selectedSpecialMentions.has(option.value) &&
        option.name.toLocaleLowerCase().includes(roleQuery),
    );
    const roleOptions = [...interaction.guild.roles.cache.values()]
      .filter(
        (role) =>
          role.id !== interaction.guild.id &&
          !selectedRoleIds.has(role.id) &&
          `${role.name} ${role.id}`.toLocaleLowerCase().includes(roleQuery),
      )
      .sort(
        (left, right) =>
          right.position - left.position || left.name.localeCompare(right.name),
      )
      .slice(0, 25)
      .map((role) => ({
        name: `@${role.name}`.slice(0, 100),
        value: role.id,
      }));
    await interaction.respond([...specialOptions, ...roleOptions].slice(0, 25));
    return;
  }

  const query = focused.value.trim().replace(/^[#@]/, "").toLocaleLowerCase();
  if (focused.name === "kenh") {
    await interaction.guild.channels.fetch();
  }
  const matches =
    focused.name === "kenh"
      ? [...interaction.guild.channels.cache.values()]
          .filter(
            (channel) =>
              [0, 5].includes(channel.type) &&
              `${channel.name} ${channel.id}`
                .toLocaleLowerCase()
                .includes(query),
          )
          .sort((left, right) => left.name.localeCompare(right.name))
          .slice(0, 25)
          .map((channel) => ({
            name: `#${channel.name}`.slice(0, 100),
            value: channel.id,
          }))
      : [];

  await interaction.respond(matches);
}

export async function buildAnnouncementModal(guild, session) {
  const channelName =
    guild.channels.cache.get(session.channelId)?.name || "kênh đã chọn";
  const roleNames = session.roleIds
    .map((roleId) => guild.roles.cache.get(roleId)?.name)
    .filter(Boolean);
  const destinationDescription = [
    `Kênh: #${channelName}.`,
    roleNames.length || session.specialMention
      ? `Nhắc ${[...roleNames.map((name) => `@${name}`), ...(session.specialMention ? [`@${session.specialMention}`] : [])].join(", ")}.`
      : "Không nhắc role.",
    "Chèn emoji trực tiếp trong nội dung.",
  ]
    .join(" ")
    .slice(0, 100);
  const content = new TextInputBuilder()
    .setCustomId("content")
    .setPlaceholder(
      `Tin gửi đến #${channelName}${roleNames.length ? ` · nhắc ${roleNames.length} role` : ""}`.slice(
        0,
        100,
      ),
    )
    .setRequired(true)
    .setMinLength(1)
    .setMaxLength(4000)
    .setStyle(TextInputStyle.Paragraph);
  if (session.content) content.setValue(session.content);

  const fileUpload = new FileUploadBuilder()
    .setCustomId("images")
    .setMinValues(0)
    .setMaxValues(4)
    .setRequired(false);

  const modal = new ModalBuilder()
    .setCustomId(`tb:${session.id}:modal`)
    .setTitle("Soạn nội dung")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Nội dung thông báo")
        .setDescription(destinationDescription)
        .setTextInputComponent(content),
    );

  modal.addLabelComponents(
    new LabelBuilder()
      .setLabel("📎 Ảnh")
      .setDescription("Tùy chọn · tối đa 4 ảnh.")
      .setFileUploadComponent(fileUpload),
  );
  return modal;
}
