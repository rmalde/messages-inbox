# Upgrade only an archive service the user already activated on this Mac.
require 'open3'

provider = 'imessage'
base = File.join(Dir.home, 'Library/Application Support/PersonalTaskArchive')
label = "ai.trajectory.personal-tasks.archive-sync.device-#{provider}"
plist = File.join(Dir.home, 'Library/LaunchAgents', label + '.plist')
state = File.join(base, provider)
exit 0 unless File.file?(plist) && File.file?(File.join(state, 'installation.json'))

manifest = 'f0f00650cbaf74849b1c675f7753a18130f0997caa947fcee7ed4795c9beef86'
expected = File.join(base, 'releases', manifest, 'scripts/archive-sync-service.mjs')
launcher = File.join(__dir__, 'archive-service.sh')
ENV['PATH'] = ['/opt/homebrew/bin','/usr/local/bin',ENV['PATH']].compact.join(':')

File.open(File.join(state, 'upgrade.lock'), File::RDWR | File::CREAT, 0600) do |lock|
  exit 0 unless lock.flock(File::LOCK_EX | File::LOCK_NB)
  current, status = Open3.capture2('/usr/bin/plutil', '-extract', 'ProgramArguments.1', 'raw', '-o', '-', plist)
  exit 1 unless status.success?
  active = current.chomp
  exit 0 if active == expected
  # A separately installed worker may carry a different enrollment policy.
  # The app updater owns only content-addressed releases from its installer.
  releases = File.join(base, 'releases')
  release = File.dirname(File.dirname(active))
  exit 0 unless File.dirname(release) == releases &&
                File.basename(release).match?(/\A[0-9a-f]{64}\z/) &&
                active == File.join(release, 'scripts/archive-sync-service.mjs')
  exit 0 unless system('/bin/launchctl', 'print', "gui/#{Process.uid}/#{label}", out: File::NULL, err: File::NULL)
  exit 1 unless system(launcher, 'prepare') && system(launcher, 'activate')
end
