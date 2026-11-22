# Upgrade only an archive service the user already activated on this Mac.
require 'open3'

provider = 'imessage'
base = File.join(Dir.home, 'Library/Application Support/PersonalTaskArchive')
label = "ai.trajectory.personal-tasks.archive-sync.device-#{provider}"
plist = File.join(Dir.home, 'Library/LaunchAgents', label + '.plist')
state = File.join(base, provider)
exit 0 unless File.file?(plist) && File.file?(File.join(state, 'installation.json'))

manifest = 'd1e9b2ebd64c8333473ac6a63d18cad3ead19e4f477f4657f6e39bdd9623395e'
expected = File.join(base, 'releases', manifest, 'scripts/archive-sync-service.mjs')
launcher = File.join(__dir__, 'archive-service.sh')
ENV['PATH'] = ['/opt/homebrew/bin','/usr/local/bin',ENV['PATH']].compact.join(':')

File.open(File.join(state, 'upgrade.lock'), File::RDWR | File::CREAT, 0600) do |lock|
  exit 0 unless lock.flock(File::LOCK_EX | File::LOCK_NB)
  current, status = Open3.capture2('/usr/bin/plutil', '-extract', 'ProgramArguments.1', 'raw', '-o', '-', plist)
  exit 1 unless status.success?
  exit 0 if current.chomp == expected
  exit 0 unless system('/bin/launchctl', 'print', "gui/#{Process.uid}/#{label}", out: File::NULL, err: File::NULL)
  exit 1 unless system(launcher, 'prepare') && system(launcher, 'activate')
end
